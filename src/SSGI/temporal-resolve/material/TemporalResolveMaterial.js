import { Matrix4 } from "three"
import { Vector3 } from "three"
import { ShaderMaterial, Uniform, Vector2 } from "three"
import vertexShader from "../shader/basicVertexShader.vert"
import fragmentShader from "../shader/temporalResolve.frag"

export class TemporalResolveMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "TemporalResolveMaterial",
			uniforms: {
				inputTexture: new Uniform(null),
				accumulatedTexture: new Uniform(null),
				velocityTexture: new Uniform(null),
				hitPositionsTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				lastDepthTexture: new Uniform(null),
				samples: new Uniform(1),
				blend: new Uniform(0.5),
				correction: new Uniform(1),
				invTexSize: new Uniform(new Vector2()),
				projectionMatrix: new Uniform(new Matrix4()),
				cameraMatrixWorld: new Uniform(new Matrix4()),
				prevViewMatrix: new Uniform(new Matrix4()),
				cameraPos: new Uniform(new Vector3())
			},
			defines: {
				maxNeighborDepthDifference: "0.00001"
			},
			vertexShader,
			fragmentShader
		})
	}
}
