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
				lastVelocityTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				lastDepthTexture: new Uniform(null),
				samples: new Uniform(1),
				blend: new Uniform(0.5),
				correction: new Uniform(1),
				invTexSize: new Uniform(new Vector2())
			},
			defines: {
				maxNeighborDepthDifference: "0.00000375",
				correctionRadius: 1
			},
			vertexShader,
			fragmentShader
		})
	}
}
