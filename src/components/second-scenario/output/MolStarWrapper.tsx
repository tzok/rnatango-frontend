import { useEffect, useRef, useState } from "react";
import {
  DefaultPluginUISpec,
  PluginUISpec,
} from "molstar/lib/mol-plugin-ui/spec";
import { createPluginUI } from "molstar/lib/mol-plugin-ui";
import { PluginConfig } from "molstar/lib/mol-plugin/config";
import { PluginUIContext } from "molstar/lib/mol-plugin-ui/context";

import "molstar/build/viewer/molstar.css";
import { ColorNames } from "molstar/lib/mol-util/color/names";

import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { StateObjectRef } from "molstar/lib/mol-state/object";
import {
  PluginStateObject as SO,
} from "molstar/lib/mol-plugin-state/objects";
import { throttleTime } from "rxjs/operators";
import { renderReact18 } from "molstar/lib/mol-plugin-ui/react18";
import { Collapse } from "antd";
import {
  range,
  second_scenario_result_differences_lcs,
} from "@/types/modelsType";
const { Panel } = Collapse;

const MolStarPluginSpec: PluginUISpec = {
  ...DefaultPluginUISpec(),
  config: [
    [PluginConfig.VolumeStreaming.Enabled, false],
    [PluginConfig.Viewport.ShowSettings, true],
    [PluginConfig.Viewport.ShowAnimation, false],
    [PluginConfig.Viewport.ShowSelectionMode, true],
  ],
  layout: {
    initial: {
      isExpanded: false,
      showControls: false,
      controlsDisplay: "reactive",
      regionState: {
        left: "full",
        top: "full",
        right: "hidden",
        bottom: "hidden",
      },
    },
  },
  components: {
    remoteState: "none",
    viewport: {},
  },
  canvas3d: {
    renderer: {
      backgroundColor: ColorNames.white,
    },
    camera: {
      helper: {
        axes: { name: "off", params: {} },
      },
    },
  },
};

async function addComponents(
  plugin: PluginUIContext,
  structure: StateObjectRef<SO.Molecule.Structure>,
  lcs: range,
  isTarget: boolean
) {
  const commonComponent =
    await plugin.builders.structure.tryCreateComponentFromExpression(
      structure,
      MS.struct.generator.atomGroups({
        "residue-test": MS.core.logic.and([
          MS.core.rel.gre([MS.ammp("auth_seq_id"), lcs.fromInclusive]),
          MS.core.rel.lte([MS.ammp("auth_seq_id"), lcs.toInclusive]),
        ]),
      }),
      isTarget ? "target-component-common" : `model-component-common`,
      isTarget ? { label: "Target" } : { label: "Model" }
    );
  const otherComponent =
    await plugin.builders.structure.tryCreateComponentFromExpression(
      structure,
      MS.struct.generator.atomGroups({
        "residue-test": MS.core.logic.or([
          MS.core.rel.lt([lcs.toInclusive, MS.ammp("auth_seq_id")]),
          MS.core.rel.gr([lcs.fromInclusive, MS.ammp("auth_seq_id")]),
        ]),
      }),
      isTarget ? "target-component-other" : `model-component-other`,
      isTarget ? { label: "Target other" } : { label: "Model other" }
    );

  await plugin.builders.structure.representation.addRepresentation(
    commonComponent!,
    {
      type: "cartoon",
      color: "uniform",
      colorParams: isTarget ? { value: 0x00c6b9 } : { value: 0xfb5f4c },
    }
  );

  await plugin.builders.structure.representation.addRepresentation(
    otherComponent!,
    {
      type: "cartoon",
      typeParams: { alpha: 0.2 },
      color: "uniform",
      colorParams: isTarget ? { value: 0x00c6b9 } : { value: 0xfb5f4c },
    }
  );
}

const addStructure = async (
  plugin: PluginUIContext,
  target_file: string,
  model_file: string,
  lcs: second_scenario_result_differences_lcs
) => {
  const data_target = await plugin.builders.data.download(
    { url: target_file },
    { state: { isGhost: true } }
  );

  const trajectory_target = await plugin.builders.structure.parseTrajectory(
    data_target,
    "mmcif"
  );
  const model_target = await plugin.builders.structure.createModel(
    trajectory_target
  );
  const structure_target = await plugin.builders.structure.createStructure(
    model_target,
    {
      name: "model",
      params: {},
    }
  );

  const data_model = await plugin.builders.data.download(
    { url: model_file },
    { state: { isGhost: true } }
  );

  const trajectory_model = await plugin.builders.structure.parseTrajectory(
    data_model,
    "mmcif"
  );
  const model_model = await plugin.builders.structure.createModel(
    trajectory_model
  );
  const structure_model = await plugin.builders.structure.createStructure(
    model_model,
    {
      name: "model",
      params: {},
    }
  );

  await addComponents(plugin, structure_model, lcs.modelNucleotideRange, false);
  await addComponents(
    plugin,
    structure_target,
    lcs.targetNucleotideRange,
    true
  );
};

type MolStarWrapperProps = {
  model_file: string;
  target_file: string;
  lcs: second_scenario_result_differences_lcs;
};

const MolStarWrapper = (props: MolStarWrapperProps) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginUIContext | null>(null);
  const [ready, setReady] = useState(false);
  const [parseError, setParseError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const plugin = await createPluginUI({
        target: parentRef.current!,
        render: renderReact18,
        spec: MolStarPluginSpec,
      });

      if (cancelled) {
        plugin.dispose();
        return;
      }

      pluginRef.current = plugin;

      if (plugin.canvas3d) {
        plugin.canvas3d.camera.stateChanged
          .asObservable()
          .pipe(throttleTime(10, undefined, { leading: true, trailing: true }))
          .subscribe(() => {
            plugin.canvas3d?.camera.setState({
              fog: 0,
              clipFar: false,
              minNear: 0.1,
            });
          });
      }

      setReady(true);
    };

    init();

    return () => {
      cancelled = true;
      if (pluginRef.current) {
        pluginRef.current.dispose();
        pluginRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pluginRef.current) return;
    setParseError(false);
    pluginRef.current.clear();
    addStructure(
      pluginRef.current,
      props.target_file,
      props.model_file,
      props.lcs
    ).then(() => {
      pluginRef.current?.behaviors.layout.leftPanelTabName.next("data");
    }).catch(() => {
      setParseError(true);
    });
  }, [props.target_file, props.model_file, props.lcs, ready]);

  return (
    <div
      style={{
        height: "650px",
        width: "100%",
        position: "relative",
        zIndex: 9999,
      }}
      ref={parentRef}
    >
      {parseError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fafafa",
            color: "#666",
            fontSize: 14,
          }}
        >
          3D structure preview not available
        </div>
      )}
    </div>
  );
};

export default MolStarWrapper;
