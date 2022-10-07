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
 * @property {boolean} [correction] how much pixels should be corrected when doing temporal resolving; higher values will result in less smearing but more noise
 * @property {boolean} [correctionRadius] how many surrounding pixels will be used for neighborhood clamping; a higher value can reduce noise when moving the camera but will result in less performance
 * @property {Number} [blurKernel] how much SSGI should be mixed with the raw SSGI
 * @property {Number} [jitter] how intense jittering should be
 * @property {Number} [jitterRoughness] how intense jittering should be in relation to a material's roughness
 * @property {Number} [steps] number of steps a ssgi ray can maximally do to find an object it intersected (and thus reflects)
 * @property {Number} [refineSteps] once we had our ray intersect something, we need to find the exact point in space it intersected and thus it reflects; this can be done through binary search with the given number of maximum steps
 * @property {Number} [steps] number of samples per pixel
 * @property {boolean} [missedRays] if there should still be ssgi for rays for which a reflecting point couldn't be found; enabling this will result in stretched looking ssgi which can look good or bad depending on the angle
 * @property {boolean} [useNormalMap] if roughness maps should be taken account of when calculating ssgi
 * @property {boolean} [useRoughnessMap] if normal maps should be taken account of when calculating ssgi
 * @property {Number} [resolutionScale] resolution of the SSGI effect, a resolution of 0.5 means the effect will be rendered at half resolution
 * @property {Boolean} [antialias] if enabled, integrated TRAA will be applied to the scene each frame resulting in smoother look and less jagging; enabling this setting is recommended if the scene needs anti-aliasing as it has practically no cost
 * @property {Boolean} [reflectionsOnly] if enabled, only reflections will be calculated for SSGI
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
	correction: 1,
	correctionRadius: 1,
	blurKernel: 2,
	blurSharpness: 8,
	jitter: 0,
	jitterRoughness: 0,
	steps: 20,
	refineSteps: 5,
	spp: 1,
	missedRays: true,
	useMap: true,
	useNormalMap: true,
	useRoughnessMap: true,
	resolutionScale: 1,
	antialias: true,
	reflectionsOnly: false
}
