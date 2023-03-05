/* eslint-disable camelcase */
import { FloatType, LinearFilter, NearestFilter, Uniform } from "three"
import { TemporalReprojectPass } from "../../temporal-reproject/TemporalReprojectPass"
import svgf_temporal_reproject from "../shader/svgf_temporal_reproject.frag"

const defaultSVGFTemporalReprojectPassOptions = {
	fullAccumulate: true,
	customComposeShader: svgf_temporal_reproject
}
export class SVGFTemporalReprojectPass extends TemporalReprojectPass {
	constructor(
		scene,
		camera,
		velocityDepthNormalPass,
		textureCount = 1,
		options = defaultSVGFTemporalReprojectPassOptions
	) {
		options = { ...defaultSVGFTemporalReprojectPassOptions, ...options }
		super(scene, camera, velocityDepthNormalPass, textureCount, options)

		// moment
		this.momentTexture = this.renderTarget.texture[0].clone()
		this.momentTexture.isRenderTargetTexture = true
		this.momentTexture.type = FloatType
		this.momentTexture.minFilter = NearestFilter
		this.momentTexture.magFilter = NearestFilter
		this.momentTexture.needsUpdate = true
		this.renderTarget.texture.push(this.momentTexture)

		const momentBuffers = /* glsl */ `
		layout(location = ${textureCount}) out vec4 gMoment;

		uniform sampler2D lastMomentTexture;
		`

		this.fullscreenMaterial.fragmentShader = momentBuffers + this.fullscreenMaterial.fragmentShader

		this.fullscreenMaterial.uniforms = {
			...this.fullscreenMaterial.uniforms,
			...{
				lastMomentTexture: new Uniform(null)
			}
		}

		const copyPassTextureCount = 2 + textureCount + 1

		this.copyPass.setTextureCount(copyPassTextureCount)
		this.copyPass.fullscreenMaterial.uniforms["inputTexture" + (copyPassTextureCount - 1)].value = this.momentTexture

		const lastMomentTexture = this.copyPass.renderTarget.texture[copyPassTextureCount - 1]
		lastMomentTexture.type = FloatType
		lastMomentTexture.minFilter = LinearFilter // need to use linear filter over nearest filter
		lastMomentTexture.magFilter = LinearFilter
		lastMomentTexture.needsUpdate = true

		this.fullscreenMaterial.uniforms.lastMomentTexture.value = lastMomentTexture

		this.fullscreenMaterial.defines.momentTextureCount = Math.min(2, textureCount)
	}
}
