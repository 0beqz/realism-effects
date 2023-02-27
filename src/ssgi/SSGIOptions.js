/**
 * Options of the SSGI effect
 * @typedef {Object} SSGIOptions
 * @property {Number} [distance] maximum distance a SSGI ray can travel to find what it reflects
 * @property {Number} [thickness] maximum depth difference between a ray and the particular depth at its screen position before refining with binary search; higher values will result in better performance
 * @property {Number} [autoThickness] whether to use a back-side depth buffer to approximate the actual thickness; enabling this may decrease performance; the thickness parameter will also be used as the minimum value
 * @property {Number} [maxRoughness] maximum roughness a texel can have to have SSGI calculated for it
 * @property {Number} [blend] a value between 0 and 1 to set how much the last frame's SSGI should be blended in; higher values will result in less noisy SSGI when moving the camera but a more smeary look
 * @property {Number} [denoiseIterations] how many times the denoise filter runs, more iterations will denoise the frame better but need more performance
 * @property {Number} [denoiseKernel] the kernel (~ number of neighboring pixels) to take into account when denoising a pixel
 * @property {Number} [denoiseDiffuse] diffuse luminance factor of the denoiser, higher values will denoise areas with varying luminance more aggressively
 * @property {Number} [denoiseSpecular] specular luminance factor of the denoiser, higher values will denoise areas with varying luminance more aggressively
 * @property {Number} [depthPhi] depth factor of the denoiser, higher values will use neighboring areas with different depth values more resulting in less noise but loss of details
 * @property {Number} [depthPhi] normals factor of the denoiser, higher values will use neighboring areas with different normals more resulting in less noise but loss of details and sharpness
 * @property {Number} [roughnessPhi] roughness factor of the denoiser setting how much the denoiser should only apply the blur to rougher surfaces, a value of 0 means the denoiser will blur mirror-like surfaces the same as rough surfaces
 * @property {Number} [directLightMultiplier] how much to boost direct lighting
 * @property {Number} [envBlur] higher values will result in lower mipmaps being sampled which will cause less noise but also less detail regarding environment lighting
 * @property {Number} [importanceSampling] whether to use importance sampling for the environment map
 * @property {Number} [maxEnvLuminance] the maximum luminance by which the environment lighting will be clamped; used to reduce noise from sharp light sources such as the sun
 * @property {Number} [steps] number of steps a SSGI ray can maximally do to find an object it intersected (and thus reflects)
 * @property {Number} [refineSteps] once we had our ray intersect something, we need to find the exact point in space it intersected and thus it reflects; this can be done through binary search with the given number of maximum steps
 * @property {Number} [spp] number of samples per pixel
 * @property {boolean} [missedRays] if there should still be SSGI for rays for which a reflecting point couldn't be found; enabling this will result in stretched looking SSGI which can look good or bad depending on the angle
 * @property {Number} [resolutionScale] resolution of the SSGI effect, a resolution of 0.5 means the effect will be rendered at half resolution
 */

/**
 * The options of the SSGI effect
 * @type {SSGIOptions}
 */
export const defaultSSGIOptions = {
	distance: 10,
	thickness: 10,
	autoThickness: false,
	maxRoughness: 1,
	blend: 0.9,
	denoiseIterations: 1,
	denoiseKernel: 2,
	denoiseDiffuse: 10,
	denoiseSpecular: 10,
	depthPhi: 2,
	normalPhi: 50,
	roughnessPhi: 1,
	envBlur: 0.5,
	importanceSampling: true,
	directLightMultiplier: 1,
	maxEnvLuminance: 5,
	steps: 20,
	refineSteps: 5,
	spp: 1,
	resolutionScale: 1,
	missedRays: false
}
