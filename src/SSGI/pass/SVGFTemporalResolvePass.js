import { GLSL3, HalfFloatType, LinearFilter, Uniform, WebGLMultipleRenderTargets } from "three"
import svgfTemporalResolve from "../shader/svgfTemporalResolve.frag"
import { TemporalResolvePass } from "../temporal-resolve/TemporalResolvePass"
import { isWebGL2Available } from "../utils/Utils"

const isWebGL2 = isWebGL2Available()

export class SVGFTemporalResolvePass extends TemporalResolvePass {
	constructor(scene, camera, options = {}) {
		const temporalResolvePassRenderTarget = isWebGL2
			? new WebGLMultipleRenderTargets(1, 1, 2, {
					minFilter: LinearFilter,
					magFilter: LinearFilter,
					type: HalfFloatType,
					depthBuffer: false
			  })
			: null

		options = {
			...options,
			...{
				customComposeShader: isWebGL2 ? svgfTemporalResolve : null,
				renderTarget: temporalResolvePassRenderTarget
			}
		}

		super(scene, camera, options)

		const webGl2Buffers = isWebGL2
			? /* glsl */ `
		layout(location = 0) out vec4 gOutput;
		layout(location = 1) out vec4 gMoment;

		uniform sampler2D momentsTexture;
		uniform sampler2D rawInputTexture;
		`
			: ""

		this.fullscreenMaterial.fragmentShader = webGl2Buffers + this.fullscreenMaterial.fragmentShader

		const webgl2Uniforms = isWebGL2
			? {
					momentsTexture: new Uniform(null),
					rawInputTexture: new Uniform(null)
			  }
			: {}

		this.fullscreenMaterial.uniforms = {
			...this.fullscreenMaterial.uniforms,
			...webgl2Uniforms
		}

		if (isWebGL2) this.fullscreenMaterial.glslVersion = GLSL3
	}

	get texture() {
		return this.renderTarget.isWebGLMultipleRenderTargets ? this.renderTarget.texture[0] : this.renderTarget.texture
	}

	get momentsTexture() {
		return this.renderTarget.isWebGLMultipleRenderTargets ? this.renderTarget.texture[1] : null
	}
}
