import { Pass } from "postprocessing"
import { HalfFloatType, LinearFilter, ShaderMaterial, Uniform, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"

export class ComposePass extends Pass {
	constructor() {
		super("ComposePass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

            uniform sampler2D inputTexture;
            uniform sampler2D diffuseTexture;
            uniform sampler2D directLightTexture;

            void main() {
                vec4 inputTexel = textureLod(inputTexture, vUv, 0.);
                vec3 color = inputTexel.rgb;
                vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.0);
        const float diffuseInfluence = 0.95;

        vec3 diffuseColor = diffuseTexel.rgb * diffuseInfluence + (1. - diffuseInfluence);
        color *= diffuseColor;

        vec4 directLightTexel = textureLod(directLightTexture, vUv, 0.0);
        color += directLightTexel.rgb * 0.1;

                gl_FragColor = vec4(color, inputTexel.a);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(null),
				diffuseTexture: new Uniform(null),
				directLightTexture: new Uniform(null)
			}
		})

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
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
