/* eslint-disable camelcase */
import { GLSL3, MeshPhysicalMaterial, Vector2 } from "three"
import gbuffer_packing from "../shader/gbuffer_packing.glsl"

class GBufferMaterial extends MeshPhysicalMaterial {
	onBeforeCompile(shader) {
		// todo: add blue noise texture
		shader.uniforms.blueNoiseTexture = { value: null }
		shader.uniforms.blueNoiseRepeat = { value: new Vector2(1, 1) }
		shader.uniforms.resolution = { value: new Vector2(1, 1) }
		shader.uniforms.cameraMoved = { value: false }

		shader.glslVersion = GLSL3

		const vertexShader = shader.vertexShader.replace(
			"void main() {",
			/* glsl */ `
            varying vec2 screenUv;
            void main() {
                screenUv = gl_Position.xy * 0.5 + 0.5;
            `
		)

		shader.vertexShader = vertexShader

		// delete all includes that have the pattern "#include <lights_something>"
		shader.vertexShader = shader.vertexShader.replace(/#include <lights_.*>/g, "")
		shader.fragmentShader = shader.fragmentShader.replace(/#include <lights_.*>/g, "")

		// delete all includes that have the pattern "#include <alpha...>"
		shader.vertexShader = shader.vertexShader.replace(/#include <alpha.*>/g, "")
		shader.fragmentShader = shader.fragmentShader.replace(/#include <alpha.*>/g, "")

		// delete all includes that have the pattern "#include <aomap...>"
		shader.vertexShader = shader.vertexShader.replace(/#include <aomap.*>/g, "")
		shader.fragmentShader = shader.fragmentShader.replace(/#include <aomap.*>/g, "")

		// delete all includes that have the pattern "#include <lightmap...>"
		shader.vertexShader = shader.vertexShader.replace(/#include <lightmap.*>/g, "")
		shader.fragmentShader = shader.fragmentShader.replace(/#include <lightmap.*>/g, "")

		// remove opaque_fragment include
		shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", "")

		// remove colorspace_fragment include
		shader.fragmentShader = shader.fragmentShader.replace("#include <colorspace_fragment>", "")

		// delete the fog_fragment include
		shader.fragmentShader = shader.fragmentShader.replace("#include <fog_fragment>", "")

		shader.fragmentShader = shader.fragmentShader
			.replace(
				"void main() {",
				/* glsl */ `
            uniform vec2 resolution;
            uniform bool cameraMoved;
            varying vec2 screenUv;

            ${gbuffer_packing}

			layout(location = 0) out vec4 color;

            void main() {
        `
			)
			.replace(
				"#include <dithering_fragment>",
				/* glsl */ `
            #include <dithering_fragment>

            vec3 worldNormal = normalize((vec4(normal, 1.) * viewMatrix).xyz);

            vec4 gBuffer = packGBuffer(diffuseColor, worldNormal, roughnessFactor, metalnessFactor, totalEmissiveRadiance);

            color = gBuffer;`
			)
	}
}

const gBufferMaterial = new GBufferMaterial()

export function createGBufferMaterial(originalMaterial) {
	const material = gBufferMaterial.clone()

	copyAllPropsToGBufferMaterial(originalMaterial, material)

	return material
}

let props = Object.keys(gBufferMaterial)

// delete the ones that start with "_"
props = props.filter(key => !key.startsWith("_") && !key.startsWith("is") && key !== "uuid" && key !== "type")

// this function attempts to copy all the props from the original material to the new GBufferMaterial
function copyAllPropsToGBufferMaterial(originalMaterial, gBufferMaterial) {
	for (const key of props) {
		if (originalMaterial[key] !== undefined) {
			gBufferMaterial[key] = originalMaterial[key]
		}
	}
}

const propsPrimitive = props.filter(
	key => typeof gBufferMaterial[key] === "string" || typeof gBufferMaterial[key] === "number"
)

export function copyPropsToGBufferMaterial(originalMaterial, gBufferMaterial) {
	for (const prop of propsPrimitive) {
		gBufferMaterial[prop] = originalMaterial[prop]
	}
}
