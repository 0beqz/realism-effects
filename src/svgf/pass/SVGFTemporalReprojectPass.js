/* eslint-disable camelcase */
import { FloatType, NearestFilter, Uniform } from "three"
import { TemporalReprojectPass } from "../../temporal-reproject/TemporalReprojectPass"
import svgf_temporal_reproject from "../shader/svgf_temporal_reproject.frag"

const defaultSVGFTemporalReprojectPassOptions = {
	fullAccumulate: false,
	logTransform: false,
	catmullRomSampling: true,
	customComposeShader: svgf_temporal_reproject
}
export class SVGFTemporalReprojectPass extends TemporalReprojectPass {
	constructor(scene, camera, velocityPass, textureCount = 1, options = defaultSVGFTemporalReprojectPassOptions) {
		options = { ...defaultSVGFTemporalReprojectPassOptions, ...options }
		super(scene, camera, velocityPass, textureCount, options)

		// moment
		this.momentTexture = this.renderTarget.texture[0].clone()
		this.momentTexture.isRenderTargetTexture = true
		this.momentTexture.type = FloatType
		this.momentTexture.minFilter = NearestFilter
		this.momentTexture.magFilter = NearestFilter
		this.momentTexture.needsUpdate = true
		this.renderTarget.texture.push(this.momentTexture)

		const momentBuffers = /* glsl */ `
		layout(location = 2) out vec4 gMoment;

		uniform sampler2D lastMomentTexture;
		`

		this.fullscreenMaterial.fragmentShader = momentBuffers + this.fullscreenMaterial.fragmentShader

		const momentUniforms = {
			lastSpecularTexture: new Uniform(null),
			specularTexture: new Uniform(null),
			lastMomentTexture: new Uniform(null)
		}

		this.fullscreenMaterial.uniforms = {
			...this.fullscreenMaterial.uniforms,
			...momentUniforms
		}

		this.copyPass.setTextureCount(2 + 2 + 1) // depth, normal, diffuse, specular, moment
		this.copyPass.fullscreenMaterial.uniforms.inputTexture4.value = this.momentTexture

		const lastMomentTexture = this.copyPass.renderTarget.texture[4]
		lastMomentTexture.type = FloatType
		lastMomentTexture.minFilter = NearestFilter
		lastMomentTexture.magFilter = NearestFilter
		lastMomentTexture.needsUpdate = true

		this.fullscreenMaterial.uniforms.lastMomentTexture.value = lastMomentTexture
	}
}
