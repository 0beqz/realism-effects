import { Pass } from "postprocessing"
import { GLSL3, NoBlending, ShaderMaterial, Uniform, WebGLMultipleRenderTargets } from "three"
import basicVertexShader from "../../utils/shader/basic.vert"

export class CopyPass extends Pass {
	needsSwap = false

	constructor(textureCount = 1) {
		super("CopyPass")

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, 1, { depthBuffer: false })

		this.setTextureCount(textureCount)
	}

	setTextureCount(textureCount) {
		let definitions = ""
		let body = ""
		for (let i = 0; i < textureCount; i++) {
			definitions += /* glsl */ `
				uniform sampler2D inputTexture${i};
				layout(location = ${i}) out vec4 gOutput${i};
			`

			body += /* glsl */ `gOutput${i} = textureLod(inputTexture${i}, vUv, 0.);`
		}

		this.fullscreenMaterial?.dispose()

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;
			
			${definitions}

            void main() {
				${body}
            }
            `,
			vertexShader: basicVertexShader,
			glslVersion: GLSL3,
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})

		for (let i = 0; i < textureCount; i++) {
			this.fullscreenMaterial.uniforms["inputTexture" + i] = new Uniform(null)

			if (i >= this.renderTarget.texture.length) {
				const texture = this.renderTarget.texture[0].clone()
				texture.isRenderTargetTexture = true
				this.renderTarget.texture.push(texture)
			}
		}
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
