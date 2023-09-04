/* eslint-disable camelcase */
import { Pass } from "postprocessing"
import { FloatType, NoBlending, ShaderMaterial, WebGLRenderTarget } from "three"
import gbuffer_packing from "../shader/gbuffer_packing.glsl"
import basicVertexShader from "../../utils/shader/basic.vert"

export class GBufferDebugPass extends Pass {
	constructor(gBufferTexture) {
		super("GBufferDebugPass")

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			depthBuffer: false,
			type: FloatType
		})

		this.renderTarget.texture.name = "GBufferDebugPass.Texture"

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;
            uniform sampler2D depthTexture;
			uniform int mode;

            #include <common>
            #include <packing>

            ${gbuffer_packing}

            void main() {
                float depth = textureLod(depthTexture, vUv, 0.).r;

				if(depth == 0.){
					gl_FragColor = vec4(0.);
					return;
				}

                Material mat = getMaterial(gBufferTexture, vUv);

                if (mode == 0) {
                    gl_FragColor = vec4(mat.diffuse.rgb, 1.);
                } else if (mode == 1) {
                    gl_FragColor = vec4(mat.diffuse.aaa, 1.);
                } else if (mode == 2) {
                    gl_FragColor = vec4(mat.normal, 1.);
                } else if (mode == 3) {
                    gl_FragColor = vec4(vec3(mat.roughness), 1.);
                } else if (mode == 4) {
                    gl_FragColor = vec4(vec3(mat.metalness), 1.);
                } else {
                    gl_FragColor = vec4(mat.emissive, 1.);
                }
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				gBufferTexture: { value: gBufferTexture },
				mode: { value: 0 }
			},
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})
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

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
