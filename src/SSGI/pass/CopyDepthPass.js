import { Pass } from "postprocessing"
import { NearestFilter, WebGLRenderTarget } from "three"
import { Uniform } from "three"
import { ShaderMaterial } from "three"
import basicVertexShader from "../shader/basic.vert"

export class CopyDepthPass extends Pass {
	constructor() {
		super("CopyDepthPass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

            uniform sampler2D copyTexture;

            void main() {
                gl_FragColor = textureLod(copyTexture, vUv, 0.);
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
