/* eslint-disable camelcase */
import { GLSL3, Matrix4, NoBlending } from "three"
import { Vector3 } from "three"
import { ShaderMaterial, Uniform, Vector2 } from "three"
import vertexShader from "../../utils/shader/basic.vert"
import fragmentShader from "../shader/temporal_reproject.frag"
import reproject from "../shader/reproject.frag"
import gbuffer_packing from "../../gbuffer/shader/gbuffer_packing.glsl"
import { unrollLoops } from "../../ssgi/utils/Utils"

export class TemporalReprojectMaterial extends ShaderMaterial {
	constructor(textureCount = 1) {
		let finalFragmentShader = fragmentShader
			.replace("#include <reproject>", reproject)
			.replace("#include <gbuffer_packing>", gbuffer_packing)

		let definitions = ""
		for (let i = 0; i < textureCount; i++) {
			definitions += /* glsl */ `
				uniform sampler2D accumulatedTexture${i};

				layout(location = ${i}) out vec4 gOutput${i};
			`
		}

		finalFragmentShader = definitions + finalFragmentShader.replaceAll("textureCount", textureCount)
		finalFragmentShader = unrollLoops(finalFragmentShader)

		const matches2 = finalFragmentShader.matchAll(/accumulatedTexture\[\s*[0-9]+\s*]/g)

		for (const [key] of matches2) {
			const number = key.replace(/[^0-9]/g, "")
			finalFragmentShader = finalFragmentShader.replace(key, "accumulatedTexture" + number)
		}

		const matches3 = finalFragmentShader.matchAll(/gOutput\[\s*[0-9]+\s*]/g)

		for (const [key] of matches3) {
			const number = key.replace(/[^0-9]/g, "")
			finalFragmentShader = finalFragmentShader.replace(key, "gOutput" + number)
		}

		super({
			type: "TemporalReprojectMaterial",
			uniforms: {
				inputTexture: new Uniform(null),
				velocityTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				lastVelocityTexture: new Uniform(null),
				neighborhoodClampIntensity: new Uniform(0),
				fullAccumulate: new Uniform(false),
				keepData: new Uniform(1),
				delta: new Uniform(0),
				invTexSize: new Uniform(new Vector2()),
				projectionMatrix: new Uniform(new Matrix4()),
				projectionMatrixInverse: new Uniform(new Matrix4()),
				cameraMatrixWorld: new Uniform(new Matrix4()),
				viewMatrix: new Uniform(new Matrix4()),
				prevViewMatrix: new Uniform(new Matrix4()),
				prevCameraMatrixWorld: new Uniform(new Matrix4()),
				prevProjectionMatrix: new Uniform(new Matrix4()),
				prevProjectionMatrixInverse: new Uniform(new Matrix4()),
				cameraPos: new Uniform(new Vector3()),
				prevCameraPos: new Uniform(new Vector3()),
				cameraNear: new Uniform(0),
				cameraFar: new Uniform(0)
			},
			vertexShader,
			fragmentShader: finalFragmentShader,
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false,
			glslVersion: GLSL3
		})

		for (let i = 0; i < textureCount; i++) {
			this.uniforms["inputTexture" + i] = new Uniform(null)
			this.uniforms["accumulatedTexture" + i] = new Uniform(null)
		}
	}
}
