import { Pass } from "postprocessing"
import { HalfFloatType, NearestFilter, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from "three"
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

            #define ALPHA_STEP 0.001

            const float maxDepthDifference = 0.000025;

            void main() {
                vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

                // skip background
                if(dot(depthTexel.rgb, depthTexel.rgb) == 0.) return;

                // vec2 bestUv;
                float totalWeight = 1.;

                vec4 inputTexel = textureLod(inputTexture, vUv, 0.);
                vec3 color = inputTexel.rgb;
                float alpha = inputTexel.a;
                float pixelSample = alpha / ALPHA_STEP + 1.0;

                float roughness = textureLod(normalTexture, vUv, 0.).a;
                float roughnessFactor = min(1., jitterRoughness * roughness + jitter);

                float kernel = blurKernel * roughnessFactor;

                bool isEarlyPixelSample = pixelSample < 16.;

                if(isEarlyPixelSample){
                    float pixelSampleWeight = max(0., pixelSample - 3.) / 13.;
                    kernel = mix(4.0, kernel, pixelSampleWeight);
                }

                if(kernel == 0.){
                    gl_FragColor = vec4(color, inputTexel.a);
                    return;
                }

                float depth = unpackRGBAToDepth(depthTexel);
                
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

                            if(depthDiff < 1.){
                                float weight = 1. - depthDiff;
                                weight = pow(weight, sharpness);
                                totalWeight += weight;
                                color += textureLod(inputTexture, neighborUv, 0.).rgb * weight;
                                // bestUv += neighborUv * weight;
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
				blurKernel: new Uniform(2),
				sharpness: new Uniform(8),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0)
			}
		})

		if (horizontal) {
			this.fullscreenMaterial.defines.horizontal = ""
		}

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
