import {
	FloatType,
	GLSL3,
	HalfFloatType,
	LinearFilter,
	NearestFilter,
	Uniform,
	WebGLMultipleRenderTargets
} from "three"
import svgfTemporalResolve from "../shader/svgfTemporalResolve.frag"
import { TemporalResolvePass } from "../temporal-resolve/TemporalResolvePass"

const defaultSVGFTemporalResolvePassOptions = {
	diffuseOnly: false,
	specularOnly: false,
	renderVelocity: false,
	blendStatic: false,
	catmullRomSampling: true,
	customComposeShader: svgfTemporalResolve
}
export class SVGFTemporalResolvePass extends TemporalResolvePass {
	constructor(scene, camera, options = defaultSVGFTemporalResolvePassOptions) {
		const bufferCount = !options.diffuseOnly && !options.specularOnly ? 3 : 2

		const temporalResolvePassRenderTarget = new WebGLMultipleRenderTargets(1, 1, bufferCount, {
			type: HalfFloatType,
			depthBuffer: false
		})

		options = {
			...defaultSVGFTemporalResolvePassOptions,
			...options,
			...{
				renderTarget: temporalResolvePassRenderTarget
			}
		}

		let diffuseAndSpecularBuffers
		if (bufferCount > 2) {
			diffuseAndSpecularBuffers = /* glsl */ `
			layout(location = 1) out vec4 gDiffuse;
			layout(location = 2) out vec4 gSpecular;

			uniform sampler2D lastSpecularTexture;
			uniform sampler2D specularTexture;
			`
		} else {
			diffuseAndSpecularBuffers = /* glsl */ `
			layout(location = 1) out vec4 gDiffuse;
			`
		}

		super(scene, camera, options)

		const momentBuffers = /* glsl */ `
		layout(location = 0) out vec4 gMoment;
		
		${diffuseAndSpecularBuffers}

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

		this.fullscreenMaterial.glslVersion = GLSL3

		// moment
		this.renderTarget.texture[0].type = FloatType
		this.renderTarget.texture[0].minFilter = NearestFilter
		this.renderTarget.texture[0].magFilter = NearestFilter
		this.renderTarget.texture[0].needsUpdate = true

		for (const texture of this.renderTarget.texture.slice(1)) {
			texture.type = HalfFloatType
			texture.minFilter = LinearFilter
			texture.magFilter = LinearFilter
			texture.needsUpdate = true
		}

		this.copyPass.fullscreenMaterial.uniforms.inputTexture4.value = this.momentTexture
		this.copyPass.fullscreenMaterial.uniforms.inputTexture5.value = this.specularTexture

		const lastMomentTexture = this.copyPass.renderTarget.texture[0].clone()
		lastMomentTexture.isRenderTargetTexture = true
		this.copyPass.renderTarget.texture.push(lastMomentTexture)
		this.copyPass.fullscreenMaterial.defines.textureCount++

		lastMomentTexture.type = FloatType
		lastMomentTexture.minFilter = NearestFilter
		lastMomentTexture.magFilter = NearestFilter
		lastMomentTexture.needsUpdate = true

		this.fullscreenMaterial.uniforms.lastMomentTexture.value = lastMomentTexture

		if (bufferCount > 2) {
			const lastSpecularTexture = this.copyPass.renderTarget.texture[0].clone()
			lastSpecularTexture.isRenderTargetTexture = true
			this.copyPass.renderTarget.texture.push(lastSpecularTexture)
			this.copyPass.fullscreenMaterial.defines.textureCount++

			lastSpecularTexture.type = HalfFloatType
			lastSpecularTexture.minFilter = LinearFilter
			lastSpecularTexture.magFilter = LinearFilter
			lastSpecularTexture.needsUpdate = true

			this.fullscreenMaterial.uniforms.lastSpecularTexture.value = lastSpecularTexture
		}

		if (options.specularOnly) {
			this.fullscreenMaterial.defines.specularOnly = ""
			this.fullscreenMaterial.defines.reprojectReflectionHitPoints = ""
		}

		if (options.diffuseOnly) {
			this.fullscreenMaterial.defines.diffuseOnly = ""
		}
	}

	get texture() {
		return this.renderTarget.texture[1]
	}

	get specularTexture() {
		const index = this.options.specularOnly ? 1 : 2
		return this.renderTarget.texture[index]
	}

	get momentTexture() {
		return this.renderTarget.texture[0]
	}
}
