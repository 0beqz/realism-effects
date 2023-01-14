import { GLSL3, HalfFloatType, NearestFilter, Uniform, WebGLMultipleRenderTargets } from "three"
import svgfTemporalResolve from "../shader/svgfTemporalResolve.frag"
import { TemporalResolvePass } from "../temporal-resolve/TemporalResolvePass"

const defaultSVGFTemporalResolvePassOptions = {
	moment: true
}
export class SVGFTemporalResolvePass extends TemporalResolvePass {
	constructor(scene, camera, options = defaultSVGFTemporalResolvePassOptions) {
		const temporalResolvePassRenderTarget = new WebGLMultipleRenderTargets(1, 1, 3, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		options = {
			...defaultSVGFTemporalResolvePassOptions,
			...options,
			...{
				customComposeShader: svgfTemporalResolve,
				renderTarget: temporalResolvePassRenderTarget,
				renderVelocity: false,
				catmullRomSampling: true
			}
		}

		super(scene, camera, options)

		const momentBuffers = /* glsl */ `
		layout(location = 0) out vec4 gOutput;
		layout(location = 1) out vec4 gMoment;
		layout(location = 2) out vec4 gOutput2;

		uniform sampler2D lastMomentTexture;
		uniform sampler2D lastSpecularTexture;
		uniform sampler2D specularTexture;
		`

		this.fullscreenMaterial.fragmentShader = momentBuffers + this.fullscreenMaterial.fragmentShader

		const momentUniforms = {
			lastMomentTexture: new Uniform(null),
			lastSpecularTexture: new Uniform(null),
			specularTexture: new Uniform(null)
		}

		this.fullscreenMaterial.uniforms = {
			...this.fullscreenMaterial.uniforms,
			...momentUniforms
		}

		if (options.moment) this.fullscreenMaterial.glslVersion = GLSL3
	}

	get texture() {
		return this.renderTarget.texture[0]
	}

	get momentTexture() {
		return this.renderTarget.texture[1]
	}

	get specularTexture() {
		return this.renderTarget.texture[2]
	}
}
