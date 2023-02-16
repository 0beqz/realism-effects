import { Matrix4 } from "three"
import { Vector3 } from "three"
import { ShaderMaterial, Uniform, Vector2 } from "three"
import vertexShader from "./../../../traa/shader/basic.vert"
import fragmentShader from "../shader/temporalResolve.frag"
import reprojection from "../shader/reprojection.glsl"

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
				normalTexture: new Uniform(null),
				lastNormalTexture: new Uniform(null),
				blend: new Uniform(0.9),
				constantBlend: new Uniform(false),
				fullAccumulate: new Uniform(false),
				invTexSize: new Uniform(new Vector2()),
				projectionMatrix: new Uniform(new Matrix4()),
				projectionMatrixInverse: new Uniform(new Matrix4()),
				cameraMatrixWorld: new Uniform(new Matrix4()),
				viewMatrix: new Uniform(new Matrix4()),
				prevViewMatrix: new Uniform(new Matrix4()),
				prevCameraMatrixWorld: new Uniform(new Matrix4()),
				cameraPos: new Uniform(new Vector3())
			},
			vertexShader,
			fragmentShader: fragmentShader.replace("#include <reprojection>", reprojection),
			toneMapped: false
		})
	}
}
