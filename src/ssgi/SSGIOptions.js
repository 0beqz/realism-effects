/* eslint-disable max-len */
/**
 * Options of the SSGI effect
 * @typedef {Object} SSGIOptions
 * @property {Number} [distance] maximum distance a SSGI ray can travel to find what it reflects
 * @property {Number} [thickness] maximum depth difference between a ray and the particular depth at its screen position before refining with binary search; higher values will result in better performance
 * @property {Number} [envBlur] higher values will result in lower mipmaps being sampled which will cause less noise but also less detail regarding environment lighting
 * @property {Number} [importanceSampling] whether to use importance sampling for the environment map
 * @property {Number} [denoiseIterations] how many times the denoise filter runs, more iterations will denoise the frame better but need more performance
 * @property {Number} [radius] the radius of the denoiser, higher values will result in less noise on less detailled surfaces but more noise on detailled surfaces
 * @property {Number} [depthPhi] depth factor of the denoiser, higher values will use neighboring areas with different depth values more resulting in less noise but loss of details
 * @property {Number} [normalPhi] normals factor of the denoiser, higher values will use neighboring areas with different normals more resulting in less noise but loss of details and sharpness
 * @property {Number} [roughnessPhi] roughness factor of the denoiser setting how much the denoiser should only apply the blur to rougher surfaces, a value of 0 means the denoiser will blur mirror-like surfaces the same as rough surfaces
 * @property {Number} [specularPhi] specular factor of the denoiser setting how much the denoiser will blur specular reflections
 * @property {Number} [lumaPhi] luminance factor of the denoiser setting how aggressive the denoiser is on areas with different luminance
 * @property {Number} [steps] number of steps a SSGI ray can maximally do to find an object it intersected (and thus reflects)
 * @property {Number} [refineSteps] once we had our ray intersect something, we need to find the exact point in space it intersected and thus it reflects; this can be done through binary search with the given number of maximum steps
 * @property {boolean} [missedRays] if there should still be SSGI for rays for which a reflecting point couldn't be found; enabling this will result in stretched looking SSGI which can look good or bad depending on the angle
 * @property {Number} [resolutionScale] resolution of the SSGI effect, a resolution of 0.5 means the effect will be rendered at half resolution
 */

/**
 * The options of the SSGI effect
 * @type {SSGIOptions}
 */
export const defaultSSGIOptions = {
	mode: "ssgi",
	distance: 10,
	thickness: 10,
	denoiseIterations: 1,
	denoiseKernel: 2,
	denoiseDiffuse: 10,
	denoiseSpecular: 10,
	radius: 3,
	phi: 0.5,
	lumaPhi: 5,
	depthPhi: 2,
	normalPhi: 50,
	roughnessPhi: 50,
	specularPhi: 50,
	envBlur: 0.5,
	importanceSampling: true,
	steps: 20,
	refineSteps: 5,
	spp: 1,
	resolutionScale: 1,
	missedRays: false,
	outputTexture: null
}
