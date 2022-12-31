import { GLSL3, HalfFloatType, NearestFilter, Uniform, WebGLMultipleRenderTargets } from "three"
import svgfTemporalResolve from "../shader/svgfTemporalResolve.frag"
import { TemporalResolvePass } from "../temporal-resolve/TemporalResolvePass"

const defaultSVGFTemporalResolvePassOptions = {
	moments: true
}
export class SVGFTemporalResolvePass extends TemporalResolvePass {
	constructor(scene, camera, options = defaultSVGFTemporalResolvePassOptions) {
		const temporalResolvePassRenderTarget = options.moments
			? new WebGLMultipleRenderTargets(1, 1, 3, {
					minFilter: NearestFilter,
					magFilter: NearestFilter,
					type: HalfFloatType,
					depthBuffer: false
			  })
			: null

		options = {
			...defaultSVGFTemporalResolvePassOptions,
			...options,
			...{
				customComposeShader: options.moments ? svgfTemporalResolve : null,
				renderTarget: temporalResolvePassRenderTarget,
				renderVelocity: false
			}
		}

		super(scene, camera, options)

		const momentsBuffers = options.moments
			? /* glsl */ `
		layout(location = 0) out vec4 gOutput;
		layout(location = 1) out vec4 gMoment;
		layout(location = 2) out vec4 gOutput2;

		uniform sampler2D lastMomentsTexture;
		uniform sampler2D lastSpecularTexture;
		uniform sampler2D specularTexture;
		`
			: ""

		this.fullscreenMaterial.fragmentShader = momentsBuffers + this.fullscreenMaterial.fragmentShader

		const momentsUniforms = options.moments
			? {
					lastMomentsTexture: new Uniform(null),
					lastSpecularTexture: new Uniform(null),
					specularTexture: new Uniform(null)
			  }
			: {}

		this.fullscreenMaterial.uniforms = {
			...this.fullscreenMaterial.uniforms,
			...momentsUniforms
		}

		if (options.moments) this.fullscreenMaterial.glslVersion = GLSL3
	}

	get texture() {
		return this.renderTarget.isWebGLMultipleRenderTargets ? this.renderTarget.texture[0] : this.renderTarget.texture
	}

	get momentsTexture() {
		return this.renderTarget.isWebGLMultipleRenderTargets ? this.renderTarget.texture[1] : null
	}

	get specularTexture() {
		return this.renderTarget.isWebGLMultipleRenderTargets ? this.renderTarget.texture[2] : null
	}
}
