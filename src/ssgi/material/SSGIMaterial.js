import { Matrix4, NoBlending, ShaderMaterial, Uniform, Vector2, Vector3 } from "three"
import vertexShader from "../../utils/shader/basic.vert"
import fragmentShader from "../shader/ssgi.frag"
// eslint-disable-next-line camelcase
import ssgi_utils from "../shader/ssgi_utils.frag"
// eslint-disable-next-line camelcase
import { useBlueNoise } from "../../utils/BlueNoiseUtils"
import gbuffer_packing from "../../utils/shader/gbuffer_packing.glsl"
import { EquirectHdrInfoUniform } from "../utils/EquirectHdrInfoUniform"

export class SSGIMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "SSGIMaterial",

			uniforms: {
				accumulatedTexture: new Uniform(null),
				gBufferTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				velocityTexture: new Uniform(null),
				directLightTexture: new Uniform(null),
				blueNoiseTexture: new Uniform(null),
				projectionMatrix: new Uniform(new Matrix4()),
				projectionMatrixInverse: new Uniform(new Matrix4()),
				cameraMatrixWorld: new Uniform(new Matrix4()),
				viewMatrix: new Uniform(new Matrix4()),
				cameraNear: new Uniform(0),
				cameraFar: new Uniform(0),
				rayDistance: new Uniform(0),
				thickness: new Uniform(0),
				frame: new Uniform(0),
				envBlur: new Uniform(0),
				maxRoughness: new Uniform(0),
				maxEnvMapMipLevel: new Uniform(0),
				envMapInfo: { value: new EquirectHdrInfoUniform() },
				envMapPosition: new Uniform(new Vector3()),
				envMapSize: new Uniform(new Vector3()),
				resolution: new Uniform(new Vector2()),
				blueNoiseRepeat: new Uniform(new Vector2())
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

			fragmentShader: fragmentShader
				.replace("#include <ssgi_utils>", ssgi_utils)
				.replace("#include <gbuffer_packing>", gbuffer_packing),
			vertexShader,

			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})

		useBlueNoise(this)
	}
}
