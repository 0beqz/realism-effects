import { ShaderChunk, ShaderLib, UniformsUtils } from "three"
import { defaultSSGIOptions, SSGIEffect } from "./SSGI"

ShaderChunk.envmap_physical_pars_fragment = ShaderChunk.envmap_physical_pars_fragment.replace(
	"vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {",
	/* glsl */ `
    uniform bool iblRadianceDisabled;

    vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
     if(iblRadianceDisabled) return vec3(0.);
    `
)

const globaliblRadianceDisabledUniform = {
	value: true
}

ShaderLib.physical.uniforms.iblRadianceDisabled = globaliblRadianceDisabledUniform

const { clone } = UniformsUtils
UniformsUtils.clone = uniforms => {
	const result = clone(uniforms)

	if ("iblRadianceDisabled" in uniforms) {
		result.iblRadianceDisabled = globaliblRadianceDisabledUniform
	}

	return result
}

let rAF
let rAF2

export class SSREffect extends SSGIEffect {
	constructor(scene, camera, options = defaultSSGIOptions) {
		options = { ...defaultSSGIOptions, ...options }
		options.reflectionsOnly = true

		super(scene, camera, options)
	}

	update(renderer, inputBuffer) {
		super.update(renderer, inputBuffer)

		globaliblRadianceDisabledUniform.value = true

		cancelAnimationFrame(rAF2)
		cancelAnimationFrame(rAF)

		rAF = requestAnimationFrame(() => {
			rAF2 = requestAnimationFrame(() => (globaliblRadianceDisabledUniform.value = false))
		})
	}
}
