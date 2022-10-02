import { Pass } from "postprocessing"
import { NearestFilter, WebGLRenderTarget } from "three"
import { Uniform } from "three"
import { ShaderMaterial } from "three"
import basicVertexShader from "../shader/basic.vert"

export class ClosestSurfacePass extends Pass {
	constructor() {
		super("ClosestSurfacePass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

            uniform sampler2D depthTexture;

            void main() {
                gl_FragColor = textureLod(depthTexture, vUv, 0.);

                gl_FragColor = vec4(0., 1., 0., 1.);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				copyTexture: new Uniform(null)
			}
		})

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			depthBuffer: false
		})
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
