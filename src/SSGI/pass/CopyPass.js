import { Pass } from "postprocessing"
import {
	GLSL3,
	HalfFloatType,
	NearestFilter,
	ShaderMaterial,
	Uniform,
	WebGLMultipleRenderTargets,
	WebGLRenderTarget
} from "three"
import basicVertexShader from "../shader/basic.vert"

export class CopyPass extends Pass {
	constructor(textureCount = 1) {
		super("CopyPass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

			uniform sampler2D inputTexture;
			layout(location = 0) out vec4 gOutput0;
			
			#if textureCount > 1
			uniform sampler2D inputTexture2;
			layout(location = 1) out vec4 gOutput1;
			#endif

			#if textureCount > 2
			uniform sampler2D inputTexture3;
			layout(location = 2) out vec4 gOutput2;
			#endif

			#if textureCount > 3
			uniform sampler2D inputTexture4;
			layout(location = 3) out vec4 gOutput3;
			#endif

            void main() {
                gOutput0 = textureLod(inputTexture, vUv, 0.);

				#if textureCount > 1
				gOutput1 = textureLod(inputTexture2, vUv, 0.);
				#endif

				#if textureCount > 2
				gOutput2 = textureLod(inputTexture3, vUv, 0.);
				#endif

				#if textureCount > 3
				gOutput3 = textureLod(inputTexture4, vUv, 0.);
				#endif
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(null),
				inputTexture2: new Uniform(null),
				inputTexture3: new Uniform(null),
				inputTexture4: new Uniform(null)
			},
			defines: {
				textureCount
			},
			glslVersion: GLSL3
		})

		const renderTargetOptions = {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
			depthBuffer: false
		}

		this.renderTarget =
			textureCount === 1
				? new WebGLRenderTarget(1, 1, renderTargetOptions)
				: new WebGLMultipleRenderTargets(1, 1, textureCount)
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
