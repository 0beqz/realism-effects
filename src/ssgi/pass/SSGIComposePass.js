/* eslint-disable camelcase */
import { Pass } from "postprocessing"
import { NoBlending, HalfFloatType, ShaderMaterial, WebGLRenderTarget } from "three"
import basicVertexShader from "../../utils/shader/basic.vert"
import gbuffer_packing from "../../utils/shader/gbuffer_packing.glsl"
import ssgi_poisson_compose_functions from "../shader/ssgi_poisson_compose_functions.glsl"

export class SSGIComposePass extends Pass {
	constructor(camera) {
		super("SSGIComposePass")

		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			depthBuffer: false,
			type: HalfFloatType
		})

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;
            uniform sampler2D depthTexture;
            uniform sampler2D diffuseGiTexture;
            uniform sampler2D specularGiTexture;
            uniform mat4 cameraMatrixWorld;
            uniform mat4 projectionMatrix;
            uniform mat4 projectionMatrixInverse;
			uniform float cameraNear;
			uniform float cameraFar;

            #include <common>
            #include <packing>

            ${gbuffer_packing}
            ${ssgi_poisson_compose_functions}

            void main() {
                float depth = textureLod(depthTexture, vUv, 0.).r;

				if(depth == 0.){
					discard;
					return;
				}

                Material mat = getMaterial(gBuffersTexture, vUv);

                vec3 viewNormal = (vec4(mat.normal, 0.) * cameraMatrixWorld).xyz;

				float viewZ = getViewZ(depth);

                // view-space position of the current texel
				vec3 viewPos = getViewPosition(viewZ);
                vec3 viewDir = normalize(viewPos);

                vec4 diffuseGi = textureLod(diffuseGiTexture, vUv, 0.);
                vec4 specularGi = textureLod(specularGiTexture, vUv, 0.);

                vec3 gi = constructGlobalIllumination(diffuseGi.rgb, specularGi.rgb, viewDir, viewNormal, mat.diffuse.rgb, mat.emissive, mat.roughness, mat.metalness);

				// apply fog
				float vFogDepth = -viewPos.z;
				float fogDensity = 0.0005;
				float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
				vec3 fogColor = vec3( 0.5 );
				gi = mix( gi, fogColor, fogFactor );

				gl_FragColor = vec4(vec3(gi), 1.);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				viewMatrix: { value: camera.matrixWorldInverse },
				cameraMatrixWorld: { value: camera.matrixWorld },
				projectionMatrix: { value: camera.projectionMatrix },
				projectionMatrixInverse: { value: camera.projectionMatrixInverse },
				cameraNear: { value: camera.near },
				cameraFar: { value: camera.far },
				gBuffersTexture: { value: null },
				depthTexture: { value: null },
				diffuseGiTexture: { value: null },
				specularGiTexture: { value: null }
			},
			defines: {
				PERSPECTIVE_CAMERA: 1
			},
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})
	}

	dispose() {
		this.renderTarget.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	render(renderer) {
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
