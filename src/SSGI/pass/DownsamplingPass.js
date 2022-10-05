import { Pass } from "postprocessing"
import { GLSL3, ShaderMaterial } from "three"
import { Vector2 } from "three"
import { WebGLMultipleRenderTargets } from "three"
import { NearestFilter } from "three"
import vertexShader from "../shader/basic.vert"

export class DownsamplingPass extends Pass {
	constructor(depthTexture, normalTexture) {
		super("DownsamplingPass")

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, 2, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			depthBuffer: false
		})

		this.fullscreenMaterial = new ShaderMaterial({
			vertexShader,
			fragmentShader: /* glsl */ `
            layout(location = 0) out vec4 gDepth;
            layout(location = 1) out vec4 gNormal;

            uniform sampler2D depthTexture;
            uniform sampler2D normalTexture;
            uniform vec2 coords1;
            uniform vec2 coords2;
            uniform vec2 coords3;
            
            varying vec2 vUv;

            #include <packing>

            int findBestDepth(const in float samples[4]) {

                // Calculate the centroid.
                float c = (samples[0] + samples[1] + samples[2] + samples[3]) / 4.0;

                float distances[4];
                distances[0] = abs(c - samples[0]); distances[1] = abs(c - samples[1]);
                distances[2] = abs(c - samples[2]); distances[3] = abs(c - samples[3]);

                float maxDistance = max(
                    max(distances[0], distances[1]),
                    max(distances[2], distances[3])
                );

                int remaining[3];
                int rejected[3];

                int i, j, k;

                for(i = 0, j = 0, k = 0; i < 4; ++i) {

                    if(distances[i] < maxDistance) {

                        // Keep the most representative samples.
                        remaining[j++] = i;

                    } else {

                        // Discard max distance samples.
                        rejected[k++] = i;

                    }

                }

                // Fill up the array in case there were two or more max distance samples.
                for(; j < 3; ++j) {

                    remaining[j] = rejected[--k];

                }

                // Final candidates.
                vec3 s = vec3(
                    samples[remaining[0]],
                    samples[remaining[1]],
                    samples[remaining[2]]
                );

                // Recalculate the controid.
                c = (s.x + s.y + s.z) / 3.0;

                distances[0] = abs(c - s.x);
                distances[1] = abs(c - s.y);
                distances[2] = abs(c - s.z);

                float minDistance = min(distances[0], min(distances[1], distances[2]));

                // Determine the index of the min distance sample.
                for(i = 0; i < 3; ++i) {

                    if(distances[i] == minDistance) {
                        
                        return remaining[i];

                    }

                }

                return remaining[i];

            }

            float readDepth(const in vec2 uv, out vec4 depthTexel) {
                depthTexel = textureLod(depthTexture, uv, 0.);

                return unpackRGBAToDepth(depthTexel);
            }

            void main(){
                vec2 uvs[4];
		        uvs[0] = vUv; uvs[1] = vUv + coords1;
		        uvs[2] = vUv + coords2; uvs[3] = vUv + coords3;

                vec4 t[4];

                // Gather depth samples in a 2x2 neighborhood.
                float d[4];
                d[0] = readDepth(uvs[0], t[0]); d[1] = readDepth(uvs[1], t[1]);
                d[2] = readDepth(uvs[2], t[2]); d[3] = readDepth(uvs[3], t[3]);

                vec4 minT;
                float minD = 0.0;
                for(int i = 0; i < 4; i++){
                    if(d[i] > minD){
                        minD = d[i];
                        minT = t[i];
                    }
                }

                int index = findBestDepth(d);

                gDepth = t[index];
                gNormal = textureLod(normalTexture, uvs[index], 0.);
            }
            `,
			uniforms: {
				depthTexture: { value: depthTexture },
				normalTexture: { value: normalTexture },
				coords1: { value: new Vector2() },
				coords2: { value: new Vector2() },
				coords3: { value: new Vector2() }
			},
			glslVersion: GLSL3
		})
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)

		const invTexSize = new Vector2(1 / width, 1 / height)

		this.fullscreenMaterial.uniforms.coords1.value.copy(invTexSize)
		this.fullscreenMaterial.uniforms.coords2.value.set(0, invTexSize.y)
		this.fullscreenMaterial.uniforms.coords3.value.set(invTexSize.x, 0)
	}

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
