﻿import { Vector2 } from "three"
import { Matrix4, ShaderMaterial, Uniform, Vector3 } from "three"
import vertexShader from "./shader/basicVertexShader.vert"
import helperFunctions from "./shader/helperFunctions.frag"
import fragmentShader from "./shader/reflectionsShader.frag"

export class ReflectionsMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "ReflectionsMaterial",

			uniforms: {
				inputTexture: new Uniform(null),
				accumulatedTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				diffuseTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				fullResDepthTexture: new Uniform(null),
				_projectionMatrix: new Uniform(new Matrix4()),
				_inverseProjectionMatrix: new Uniform(new Matrix4()),
				cameraMatrixWorld: new Uniform(new Matrix4()),
				cameraNear: new Uniform(0),
				cameraFar: new Uniform(0),
				rayDistance: new Uniform(0),
				roughnessFade: new Uniform(0),
				fade: new Uniform(0),
				thickness: new Uniform(0),
				ior: new Uniform(0),
				maxDepthDifference: new Uniform(0),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0),
				maxRoughness: new Uniform(0),
				samples: new Uniform(0),
				envMap: new Uniform(null),
				envMapPosition: new Uniform(new Vector3()),
				envMapSize: new Uniform(new Vector3()),
				viewMatrix: new Uniform(new Matrix4()),
				invTexSize: new Uniform(new Vector2())
			},

			defines: {
				steps: 20,
				refineSteps: 5,
				spp: 1,
				CUBEUV_TEXEL_WIDTH: 0,
				CUBEUV_TEXEL_HEIGHT: 0,
				CUBEUV_MAX_MIP: 0,
				vWorldPosition: "worldPos"
			},

			fragmentShader: fragmentShader.replace("#include <helperFunctions>", helperFunctions),
			vertexShader,

			toneMapped: false,
			depthWrite: false,
			depthTest: false
		})
	}
}
