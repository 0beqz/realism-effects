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
            uniform vec2 invTexSize;
            uniform float sharpness;
            uniform float blurKernel;

            #include <packing>

            void main() {
                vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
                float depth = unpackRGBAToDepth(depthTexel);

                vec2 bestUv;
                float totalWeight = 1.;
                float maxDepth = depth;

                const float maxDepthDifference = 0.0000025;

                vec4 inputTexel = textureLod(inputTexture, vUv, 0.);
                vec3 color = inputTexel.rgb;
                
                for(float i = -blurKernel; i <= blurKernel; i++){
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
                                bestUv += neighborUv * weight;
                                totalWeight += weight;
                                maxDepth = max(maxDepth, neighborDepth);

                                color += textureLod(inputTexture, neighborUv, 0.).rgb * weight;
                            }
                        }
                    }
                }

                // skip background
                if(dot(depthTexel.rgb, depthTexel.rgb) == 0.){
                    return;
                }

                if(totalWeight == 0.){
                    color = textureLod(inputTexture, vUv, 0.).rgb;
                }else{
                    bestUv /= totalWeight;
                    color /= totalWeight;
                }

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
				invTexSize: new Uniform(new Vector2()),
				blurKernel: new Uniform(3),
				sharpness: new Uniform(32)
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
