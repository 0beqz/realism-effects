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
            uniform float blurPower;
            uniform float blurSharpness;
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

                vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
                vec3 normal = unpackRGBToNormal(normalTexel.rgb);
                float roughness = normalTexel.a;
                float roughnessFactor = min(1., jitterRoughness * roughness + jitter);

                float kernel = blurKernel * roughnessFactor;

                bool isEarlyPixelSample = pixelSample < 16.;

                // if(isEarlyPixelSample){
                //     float pixelSampleWeight = max(0., pixelSample - 3.) / 13.;
                //     kernel = mix(4.0, kernel, pixelSampleWeight);
                // }

                kernel = round(kernel);

                if(kernel == 0.){
                    gl_FragColor = vec4(color, inputTexel.a);
                    return;
                }

                float normalSimilarityMix = 1.0 - blurSharpness;
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

                            float depthDiff = abs(depth - neighborDepth) * depth;
                            depthDiff /= maxDepthDifference;

                            if(depthDiff < 1.){
                                vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
                                vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);
                                
                                float normalSimilarity = dot(neighborNormal, normal);
                                normalSimilarity = mix(normalSimilarity, 1., normalSimilarityMix);

                                float weight = 1. - depthDiff;
                                weight = pow(weight, blurPower);
                                totalWeight += weight;
                                color += textureLod(inputTexture, neighborUv, 0.).rgb * weight * normalSimilarity;
                                // color += vec3(0., 1., 0.) * weight * sim;
                                // bestUv += neighborUv * weight;
                            }
                        }
                    }
                }
                
                color /= totalWeight;

                if(min(color.r, min(color.g, color.b)) < 0.0) color = inputTexel.rgb;

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
				blurPower: new Uniform(8),
				blurSharpness: new Uniform(1),
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
