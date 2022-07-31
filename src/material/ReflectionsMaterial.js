import { Matrix4, ShaderMaterial, Uniform } from "three"
import helperFunctions from "./shader/helperFunctions.frag"
import fragmentShader from "./shader/reflectionsShader.frag"
import vertexShader from "./shader/basicVertexShader.vert"

export class ReflectionsMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "ReflectionsMaterial",

			uniforms: {
				inputTexture: new Uniform(null),
				accumulatedTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				_projectionMatrix: new Uniform(new Matrix4()),
				_inverseProjectionMatrix: new Uniform(new Matrix4()),
				cameraMatrixWorld: new Uniform(new Matrix4()),
				cameraNear: new Uniform(0),
				cameraFar: new Uniform(0),
				rayStep: new Uniform(0.1),
				intensity: new Uniform(1),
				roughnessFadeOut: new Uniform(1),
				rayFadeOut: new Uniform(0),
				thickness: new Uniform(10),
				ior: new Uniform(1.45),
				maxDepthDifference: new Uniform(1),
				maxDepth: new Uniform(1),
				jitter: new Uniform(0.5),
				jitterRough: new Uniform(0.5),
				jitterSpread: new Uniform(1),
				maxRoughness: new Uniform(1),
				samples: new Uniform(0)
			},

			defines: {
				MAX_STEPS: 20,
				NUM_BINARY_SEARCH_STEPS: 5
			},

			fragmentShader: fragmentShader.replace("#include <helperFunctions>", helperFunctions),
			vertexShader,

			toneMapped: false,
			depthWrite: false,
			depthTest: false
		})
	}
}
