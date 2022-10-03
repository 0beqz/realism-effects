import { Pass } from "postprocessing"
import { HalfFloatType, LinearFilter, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"

export class UpscalePass extends Pass {
	constructor({ horizontal } = { horizontal: true }) {
		super("UpscalePass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

            uniform sampler2D inputTexture;
            uniform sampler2D depthTexture;
            uniform sampler2D normalTexture;
            uniform vec2 invTexSize;
            uniform float sharpness;
            uniform float blurKernel;
            uniform float jitter;
            uniform float jitterRoughness;

            #include <packing>

            void main() {
                vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

                // skip background
                if(dot(depthTexel.rgb, depthTexel.rgb) == 0.){
                    return;
                }

                float depth = unpackRGBAToDepth(depthTexel);

                // vec2 bestUv;
                float totalWeight = 1.;

                // const float maxDepthDifference = 0.0000025;
                const float maxDepthDifference = 0.00001;

                vec4 inputTexel = textureLod(inputTexture, vUv, 0.);
                vec3 color = inputTexel.rgb;

                float roughness = textureLod(normalTexture, vUv, 0.).a;

                float kernel = floor((blurKernel + 2.0) * (jitterRoughness * roughness + jitter));

                if(kernel == 0.){
                    gl_FragColor = vec4(color, inputTexel.a);
                    return;
                }
                
                for(float i = -kernel; i <= kernel; i++){
                    if(i != 0.){
                        #ifdef horizontal
                        vec2 neighborVec = vec2(i, 0.);
                        #else
                        vec2 neighborVec = vec2(0., i);
                        #endif
                        vec2 neighborUv = vUv + neighborVec * invTexSize;

                        if (all(greaterThanEqual(neighborUv, vec2(0.))) && all(lessThanEqual(neighborUv, vec2(1.)))) {
                            float neighborDepth = unpackRGBAToDepth(textureLod(depthTexture, neighborUv, 0.));

                            float depthDiff = abs(depth - neighborDepth);
                            depthDiff /= maxDepthDifference;
                            if(depthDiff > 1.) depthDiff = 1.;

                            float weight = 1. - depthDiff;
                            weight = pow(weight, sharpness);

                            if(weight > 0.){
                                // bestUv += neighborUv * weight;
                                totalWeight += weight;

                                color += textureLod(inputTexture, neighborUv, 0.).rgb * weight;
                            }
                        }
                    }
                }
                
                color /= totalWeight;

                // bestUv /= totalWeight;
                // bestUv -= vUv;
                // bestUv *= 1000.;
                // color = bestUv.xyx;

                gl_FragColor = vec4(color, inputTexel.a);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				invTexSize: new Uniform(new Vector2()),
				blurKernel: new Uniform(3),
				sharpness: new Uniform(8),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0)
			}
		})

		if (horizontal) {
			this.fullscreenMaterial.defines.horizontal = ""
		}

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
