/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  swcMinify: false,
  images: {
    unoptimized: true,
  },

  // trailingSlash: true,
  // experimental: {
  //   missingSuspenseWithCSRBailout: false,
  // },
};
// export default nextConfig;
module.exports = nextConfig;
