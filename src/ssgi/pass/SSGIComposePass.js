/* eslint-disable camelcase */
import { Pass } from "postprocessing"
import { NoBlending, HalfFloatType, ShaderMaterial, WebGLRenderTarget } from "three"
import basicVertexShader from "../../utils/shader/basic.vert"
import gbuffer_packing from "../shader/gbuffer_packing.glsl"
import ssgi_poisson_compose_functions from "../shader/ssgi_poisson_compose_functions.glsl"

export class SSGIComposePass extends Pass {
	constructor(camera) {
		super("SSGIComposePass")

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

            #include <common>
            

            ${gbuffer_packing}
            ${ssgi_poisson_compose_functions}

            void main() {
                vec3 diffuse, normal, emissive;
                float roughness, metalness;

                getGData(gBuffersTexture, vUv, diffuse, normal, roughness, metalness, emissive);

                float depth = textureLod(depthTexture, vUv, 0.).r;

				if(depth == 1.){
					gl_FragColor = vec4(0.);
					return;
				}

                vec3 viewNormal = (vec4(normal, 0.) * cameraMatrixWorld).xyz;

                // view-space position of the current texel
                vec3 viewPos = getViewPosition(depth);
                vec3 viewDir = normalize(viewPos);

                vec4 diffuseGi = textureLod(diffuseGiTexture, vUv, 0.);
                vec4 specularGi = textureLod(specularGiTexture, vUv, 0.);

                vec3 gi = constructGlobalIllumination(diffuseGi.rgb, specularGi.rgb, viewDir, viewNormal, diffuse, emissive, roughness, metalness);

				// gi = diffuseGi;

				gl_FragColor = vec4(gi, diffuseGi.a + specularGi.a);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				viewMatrix: { value: camera.matrixWorldInverse },
				cameraMatrixWorld: { value: camera.matrixWorld },
				projectionMatrix: { value: camera.projectionMatrix },
				projectionMatrixInverse: { value: camera.projectionMatrixInverse },
				gBuffersTexture: { value: null },
				depthTexture: { value: null },
				diffuseGiTexture: { value: null },
				specularGiTexture: { value: null }
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
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}