import { Pass } from "postprocessing"
import { HalfFloatType, NearestFilter, WebGLRenderTarget } from "three"
import { Uniform } from "three"
import { ShaderMaterial } from "three"
import basicVertexShader from "../shader/basic.vert"

export class CopyPass extends Pass {
	constructor() {
		super("CopyPass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

            uniform sampler2D inputTexture;

            void main() {
                gl_FragColor = textureLod(inputTexture, vUv, 0.);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(null)
			}
		})

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
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
