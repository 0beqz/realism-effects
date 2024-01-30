/* eslint-disable camelcase */
import { Pass } from "postprocessing"
import { FloatType, NearestFilter, NoBlending, ShaderMaterial, WebGLRenderTarget } from "three"
import gbuffer_packing from "../../gbuffer/shader/gbuffer_packing.glsl"
import basicVertexShader from "../../utils/shader/basic.vert"
import ssgi_poisson_compose_functions from "../shader/denoiser_compose_functions.glsl"

export class DenoiserComposePass extends Pass {
	constructor(camera, textures, gBufferTexture, depthTexture, options = {}) {
		super("DenoiserComposePass")

		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			depthBuffer: false,
			type: FloatType,
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})

		this.renderTarget.texture.name = "DenoiserComposePass.Texture"

		let diffuseGiTexture
		let specularGiTexture

		if (options.inputType === "diffuseSpecular") {
			diffuseGiTexture = textures[0]
			specularGiTexture = textures[1]
		} else if (options.inputType === "diffuse") {
			diffuseGiTexture = textures[0]
		} else if (options.inputType === "specular") {
			specularGiTexture = textures[0]
		}

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;
            uniform sampler2D sceneTexture;
            uniform highp sampler2D depthTexture;
            uniform sampler2D diffuseGiTexture;
            uniform sampler2D specularGiTexture;
            uniform mat4 cameraMatrixWorld;
            uniform mat4 projectionMatrix;
            uniform mat4 projectionMatrixInverse;
			uniform float cameraNear;
			uniform float cameraFar;

            #include <common>
            #include <packing>

			#define TYPE_DIFFUSE_SPECULAR 0
			#define TYPE_DIFFUSE 1
			#define TYPE_SPECULAR 2

            ${gbuffer_packing}
            ${ssgi_poisson_compose_functions}

            void main() {
                float depth = textureLod(depthTexture, vUv, 0.).r;

				if(depth == 1.){
					discard;
					return;
				}

				// on Android there's a bug where using "vec3 normal = unpackNormal(textureLod(velocityTexture, vUv, 0.).b);" instead of
				// "vec3 normal = unpackNormal(velocity.b);" causes the normal to be distorted (possibly due to packHalf2x16 function)

                Material mat = getMaterial(gBufferTexture, vUv);

                vec3 viewNormal = (vec4(mat.normal, 0.) * cameraMatrixWorld).xyz;

				float viewZ = getViewZ(depth);

                // view-space position of the current texel
				vec3 viewPos = getViewPosition(viewZ);
                vec3 viewDir = normalize(viewPos);

                vec4 diffuseGi = textureLod(diffuseGiTexture, vUv, 0.);
                vec4 specularGi = textureLod(specularGiTexture, vUv, 0.);

                vec3 gi = constructGlobalIllumination(diffuseGi.rgb, specularGi.rgb, viewDir, viewNormal, mat.diffuse.rgb, mat.emissive, mat.roughness, mat.metalness);

				gl_FragColor = vec4(gi, 1.);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				sceneTexture: { value: null },
				viewMatrix: { value: camera.matrixWorldInverse },
				cameraMatrixWorld: { value: camera.matrixWorld },
				projectionMatrix: { value: camera.projectionMatrix },
				projectionMatrixInverse: { value: camera.projectionMatrixInverse },
				cameraNear: { value: camera.near },
				cameraFar: { value: camera.far },
				gBufferTexture: { value: gBufferTexture },
				depthTexture: { value: depthTexture },
				diffuseGiTexture: { value: diffuseGiTexture },
				specularGiTexture: { value: specularGiTexture }
			},
			defines: {
				inputType: ["diffuseSpecular", "diffuse", "specular"].indexOf(options.inputType) ?? 0
			},
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})

		if (camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""
	}

	get texture() {
		return this.renderTarget.texture
	}

	dispose() {
		this.renderTarget.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	setSceneTexture(texture) {
		this.fullscreenMaterial.uniforms.sceneTexture.value = texture
	}

	render(renderer) {
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
