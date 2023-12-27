/* eslint-disable camelcase */
import { MeshPhysicalMaterial, Vector2 } from "three"
import gbuffer_packing from "../shader/gbuffer_packing.glsl"
import { setupBlueNoise } from "../../utils/BlueNoiseUtils"

class GBufferMaterial extends MeshPhysicalMaterial {
	onBeforeCompile(shader) {
		this.uniforms = shader.uniforms

		shader.uniforms.resolution = { value: new Vector2(1, 1) }
		shader.uniforms.cameraNotMovedFrames = { value: 0 }

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

		// delete all includes that have the pattern "#include <alphahash...>"
		shader.vertexShader = shader.vertexShader.replace(/#include <alphahash.*>/g, "")
		shader.fragmentShader = shader.fragmentShader.replace(/#include <alphahash.*>/g, "")

		// delete all includes that have the pattern "#include <alphatest...>"
		shader.vertexShader = shader.vertexShader.replace(/#include <alphatest.*>/g, "")
		shader.fragmentShader = shader.fragmentShader.replace(/#include <alphatest.*>/g, "")

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
			#define vUv gl_FragCoord.xy
            uniform vec2 resolution;
            uniform float cameraNotMovedFrames;

            ${gbuffer_packing}

            void main() {
					float a = opacity;

					#ifdef USE_ALPHAMAP
						a *= texture2D( alphaMap, vAlphaMapUv ).g;
					#endif

					if (cameraNotMovedFrames == 0.) {
						if(a < 0.5) {
							discard;
							return;
						}

						a = 1.;
					} else if (a != 1.) {
						float aStep = a > 0.5 ? 1. : 0.;
						a = mix(a, aStep, (1. / (cameraNotMovedFrames * 0.1 + 1.)));

						vec4 noise = blueNoise();
						if (noise.x > a) {
							discard;
							return;
						}
					}
        `
			)
			.replace(
				"#include <dithering_fragment>",
				/* glsl */ `
            #include <dithering_fragment>

            vec3 worldNormal = normalize((vec4(normal, 1.) * viewMatrix).xyz);

            vec4 gBuffer = packGBuffer(diffuseColor, worldNormal, roughnessFactor, metalnessFactor, totalEmissiveRadiance);

            gl_FragColor = gBuffer;`
			)

		const { uniforms, fragmentShader } = setupBlueNoise(shader.fragmentShader)
		shader.uniforms = { ...shader.uniforms, ...uniforms }
		shader.fragmentShader = fragmentShader
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
props = props.filter(
	key => !key.startsWith("_") && !key.startsWith("is") && key !== "uuid" && key !== "type" && key !== "transparent"
)

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
