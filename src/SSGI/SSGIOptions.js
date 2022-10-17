/**
 * Options of the SSGI effect
 * @typedef {Object} SSGIOptions
 * @property {Number} [intensity] intensity of the ssgi
 * @property {Number} [power] the exponent by which the final ssgi color will be potentiated
 * @property {Number} [distance] maximum distance a ssgi ray can travel to find what it reflects
 * @property {Number} [roughnessFade] how intense ssgi should be on rough spots; a higher value will make ssgi fade out quicker on rough spots
 * @property {Number} [thickness] maximum depth difference between a ray and the particular depth at its screen position before refining with binary search; higher values will result in better performance
 * @property {Number} [ior] Index of Refraction, used for calculating fresnel; reflections tend to be more intense the steeper the angle between them and the viewer is, the ior parameter sets how much the intensity varies
 * @property {Number} [maxRoughness] maximum roughness a texel can have to have ssgi calculated for it
 * @property {Number} [blend] a value between 0 and 1 to set how much the last frame's ssgi should be blended in; higher values will result in less noisy ssgi when moving the camera but a more smeary look
 * @property {Number} [denoiseIterations] how many times the denoise filter runs, more iterations will denoise the frame better but need more performance
 * @property {Number} [denoiseKernel] how much SSGI should be mixed with the raw SSGI
 * @property {Number} [lumaPhi] luminance factor of the denoiser, higher values will denoise areas with varying luminance more aggressively
 * @property {Number} [depthPhi] depth factor of the denoiser, higher values will use neighboring areas with different depth values more resulting in less noise but loss of details
 * @property {Number} [depthPhi] normals factor of the denoiser, higher values will use neighboring areas with different normals more resulting in less noise but loss of details and sharpness
 * @property {Number} [roughnessPhi] roughness factor of the denoiser setting how much the denoiser should only apply the blur to rougher surfaces, a value of 0 means the denoiser will blur mirror-like surfaces the same as rough surfaces
 * @property {Number} [jitter] how intense jittering should be
 * @property {Number} [jitterRoughness] how intense jittering should be in relation to a material's roughness
 * @property {Number} [steps] number of steps a ssgi ray can maximally do to find an object it intersected (and thus reflects)
 * @property {Number} [refineSteps] once we had our ray intersect something, we need to find the exact point in space it intersected and thus it reflects; this can be done through binary search with the given number of maximum steps
 * @property {Number} [spp] number of samples per pixel
 * @property {boolean} [missedRays] if there should still be ssgi for rays for which a reflecting point couldn't be found; enabling this will result in stretched looking ssgi which can look good or bad depending on the angle
 * @property {boolean} [useNormalMap] if roughness maps should be taken account of when calculating ssgi
 * @property {boolean} [useRoughnessMap] if normal maps should be taken account of when calculating ssgi
 * @property {Number} [resolutionScale] resolution of the SSGI effect, a resolution of 0.5 means the effect will be rendered at half resolution
 * @property {Boolean} [antialias] if enabled, integrated TRAA will be applied to the scene each frame resulting in smoother look and less jagging; enabling this setting is recommended if the scene needs anti-aliasing as it has practically no cost
 */

/**
 * The options of the SSGI effect
 * @type {SSGIOptions}
 */
export const defaultSSGIOptions = {
	intensity: 1,
	power: 1,
	distance: 10,
	roughnessFade: 1,
	thickness: 10,
	ior: 2.33,
	maxRoughness: 1,
	blend: 0.9,
	denoiseIterations: 1,
	denoiseKernel: 2,
	lumaPhi: 10,
	depthPhi: 2,
	normalPhi: 50,
	roughnessPhi: 1,
	jitter: 0,
	jitterRoughness: 0,
	steps: 20,
	refineSteps: 5,
	spp: 1,
	missedRays: true,
	useNormalMap: true,
	useRoughnessMap: true,
	resolutionScale: 1,
	antialias: true
}
