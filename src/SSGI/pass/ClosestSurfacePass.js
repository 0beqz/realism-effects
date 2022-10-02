import { Pass } from "postprocessing"
import { HalfFloatType, NearestFilter, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"

export class ClosestSurfacePass extends Pass {
	constructor() {
		super("ClosestSurfacePass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

            uniform sampler2D inputTexture;
            uniform sampler2D depthTexture;
            uniform vec2 invTexSize;
            uniform float sharpness;

            #include <packing>

            void main() {
                vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
                float depth = unpackRGBAToDepth(depthTexel);

                vec2 bestUv;
                float totalWeight = 1.;
                float maxDepth = depth;

                const float maxDepthDifference = 0.00005;

                vec4 inputTexel = textureLod(inputTexture, vUv, 0.);
                vec3 color = inputTexel.rgb;

                const float neighborPixels = 3.;

                for(float x = -neighborPixels; x <= neighborPixels; x++){
                    for(float y = -neighborPixels; y <= neighborPixels; y++){
                        if(x != 0. || y != 0.){
                            vec2 neighborUv = vUv + vec2(x, y) * invTexSize;
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
				sharpness: new Uniform(8)
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
