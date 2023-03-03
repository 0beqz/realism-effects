import {
	DataTexture,
	EquirectangularReflectionMapping,
	FloatType,
	LinearEncoding,
	NearestFilter,
	PMREMGenerator,
	RepeatWrapping,
	RGBAFormat,
	ShaderMaterial,
	TextureLoader,
	Vector2,
	WebGLRenderTarget
} from "three"
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js"

export const utilsGLSL = /* glsl */ `

	// TODO: possibly this should be renamed something related to material or path tracing logic

	#ifndef RAY_OFFSET
	#define RAY_OFFSET 1e-4
	#endif

	// adjust the hit point by the surface normal by a factor of some offset and the
	// maximum component-wise value of the current point to accommodate floating point
	// error as values increase.
	vec3 stepRayOrigin( vec3 rayOrigin, vec3 rayDirection, vec3 offset, float dist ) {

		vec3 point = rayOrigin + rayDirection * dist;
		vec3 absPoint = abs( point );
		float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
		return point + offset * ( maxPoint + 1.0 ) * RAY_OFFSET;

	}

	// https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md#attenuation
	vec3 transmissionAttenuation( float dist, vec3 attColor, float attDist ) {

		vec3 ot = - log( attColor ) / attDist;
		return exp( - ot * dist );

	}

	vec3 getHalfVector( vec3 wi, vec3 wo, float eta ) {

		// get the half vector - assuming if the light incident vector is on the other side
		// of the that it's transmissive.
		vec3 h;
		if ( wi.z > 0.0 ) {

			h = normalize( wi + wo );

		} else {

			// Scale by the ior ratio to retrieve the appropriate half vector
			// From Section 2.2 on computing the transmission half vector:
			// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
			h = normalize( wi + wo * eta );

		}

		h *= sign( h.z );
		return h;

	}

	vec3 getHalfVector( vec3 a, vec3 b ) {

		return normalize( a + b );

	}

	// The discrepancy between interpolated surface normal and geometry normal can cause issues when a ray
	// is cast that is on the top side of the geometry normal plane but below the surface normal plane. If
	// we find a ray like that we ignore it to avoid artifacts.
	// This function returns if the direction is on the same side of both planes.
	bool isDirectionValid( vec3 direction, vec3 surfaceNormal, vec3 geometryNormal ) {

		bool aboveSurfaceNormal = dot( direction, surfaceNormal ) > 0.0;
		bool aboveGeometryNormal = dot( direction, geometryNormal ) > 0.0;
		return aboveSurfaceNormal == aboveGeometryNormal;

	}

	// ray sampling x and z are swapped to align with expected background view
	vec2 equirectDirectionToUv( vec3 direction ) {

		// from Spherical.setFromCartesianCoords
		vec2 uv = vec2( atan( direction.z, direction.x ), acos( direction.y ) );
		uv /= vec2( 2.0 * PI, PI );

		// apply adjustments to get values in range [0, 1] and y right side up
		uv.x += 0.5;
		uv.y = 1.0 - uv.y;
		return uv;

	}

	vec3 equirectUvToDirection( vec2 uv ) {

		// undo above adjustments
		uv.x -= 0.5;
		uv.y = 1.0 - uv.y;

		// from Vector3.setFromSphericalCoords
		float theta = uv.x * 2.0 * PI;
		float phi = uv.y * PI;

		float sinPhi = sin( phi );

		return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

	}

	// power heuristic for multiple importance sampling
	float misHeuristic( float a, float b ) {

		float aa = a * a;
		float bb = b * b;
		return aa / ( aa + bb );

	}

	// tentFilter from Peter Shirley's 'Realistic Ray Tracing (2nd Edition)' book, pg. 60
	// erichlof/THREE.js-PathTracing-Renderer/
	float tentFilter( float x ) {

		return x < 0.5 ? sqrt( 2.0 * x ) - 1.0 : 1.0 - sqrt( 2.0 - ( 2.0 * x ) );

	}
`

export class MaterialBase extends ShaderMaterial {
	constructor(shader) {
		super(shader)

		// eslint-disable-next-line guard-for-in
		for (const key in this.uniforms) {
			Object.defineProperty(this, key, {
				get() {
					return this.uniforms[key].value
				},

				set(v) {
					this.uniforms[key].value = v
				}
			})
		}
	}

	// sets the given named define value and sets "needsUpdate" to true if it's different
	setDefine(name, value = undefined) {
		if (value === undefined || value === null) {
			if (name in this.defines) {
				delete this.defines[name]
				this.needsUpdate = true
			}
		} else {
			if (this.defines[name] !== value) {
				this.defines[name] = value
				this.needsUpdate = true
			}
		}
	}
}

import blueNoiseImage from "../src/utils/blue_noise_64_rgba.png"

class PMREMCopyMaterial extends MaterialBase {
	constructor() {
		super({
			uniforms: {
				envMap: { value: null },
				blur: { value: 0 },
				texSize: { value: new Vector2() },
				blueNoiseTexture: { value: null },
				blueNoiseRepeat: { value: new Vector2() }
			},

			vertexShader: /* glsl */ `

				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}

			`,

			fragmentShader: /* glsl */ `

				#include <common>
				#include <cube_uv_reflection_fragment>

				${utilsGLSL}

				uniform sampler2D envMap;
				uniform sampler2D blueNoiseTexture;
				uniform vec2 blueNoiseRepeat;
				uniform float blur;
				uniform vec2 texSize;
				varying vec2 vUv;

				#define SAMPLES 1024.0

				const vec4 harmoniousNumbers1234 = vec4(1.618033988749895, 1.3247179572447458, 1.2207440846057596, 1.1673039782614187);

				// internal RNG state
				uvec4 s0, s1;
				ivec2 pixel;

				void rng_initialize(vec2 p, int frame) {
					pixel = ivec2(p);

					// white noise seed
					s0 = uvec4(p, uint(frame), uint(p.x) + uint(p.y));

					// blue noise seed
					s1 = uvec4(frame, frame * 15843, frame * 31 + 4566, frame * 2345 + 58585);
				}

				// https://www.pcg-random.org/
				void pcg4d(inout uvec4 v) {
					v = v * 1664525u + 1013904223u;
					v.x += v.y * v.w;
					v.y += v.z * v.x;
					v.z += v.x * v.y;
					v.w += v.y * v.z;
					v = v ^ (v >> 16u);
					v.x += v.y * v.w;
					v.y += v.z * v.x;
					v.z += v.x * v.y;
					v.w += v.y * v.z;
				}

				// random blue noise sampling pos
				ivec2 shift2() {
					pcg4d(s1);
					return (pixel + ivec2(s1.xy % 0x0fffffffu)) % 1024;
				}

				void main() {
					float pos = vUv.y * texSize.x * texSize.y + vUv.x * texSize.x;
				    rng_initialize(vUv * texSize, int(pos));

					vec3 color;

					vec2 blueNoiseUv = vec2(shift2()) * blueNoiseRepeat * (1. / texSize);
					vec4 blueNoise = textureLod(blueNoiseTexture, blueNoiseUv, 0.);
				
					for(float i = 0.; i < SAMPLES; i++){
						vec3 r = fract(blueNoise + i * harmoniousNumbers1234).xyz;
						r = normalize(r * 2. - 1.);

						vec3 rayDirection = equirectUvToDirection( vUv );
						vec3 randomDir = r;

						rayDirection = mix(rayDirection, randomDir, blur);
						
						color += textureCubeUV( envMap, rayDirection, blur).rgb;
					}

					color /= SAMPLES;

					gl_FragColor = vec4(color, 1.);

				}

			`
		})
	}
}

export class BlurredEnvMapGenerator {
	constructor(renderer) {
		this.renderer = renderer
		this.pmremGenerator = new PMREMGenerator(renderer)
		this.copyQuad = new FullScreenQuad(new PMREMCopyMaterial())
		this.renderTarget = new WebGLRenderTarget(1, 1, { type: FloatType, format: RGBAFormat })
	}

	async init() {
		return new Promise(resolve => {
			new TextureLoader().load(blueNoiseImage, blueNoiseTexture => {
				if (this.copyQuad.material.uniforms.blueNoiseTexture.value) {
					resolve()
					return
				}

				blueNoiseTexture.minFilter = NearestFilter
				blueNoiseTexture.magFilter = NearestFilter
				blueNoiseTexture.wrapS = RepeatWrapping
				blueNoiseTexture.wrapT = RepeatWrapping
				blueNoiseTexture.encoding = LinearEncoding

				this.copyQuad.material.uniforms.blueNoiseTexture.value = blueNoiseTexture

				resolve()
			})
		})
	}

	dispose() {
		this.pmremGenerator.dispose()
		this.copyQuad.dispose()
		this.renderTarget.dispose()
	}

	generate(texture, blur) {
		console.time("blur")
		const { pmremGenerator, renderTarget, copyQuad, renderer } = this

		// get the pmrem target
		const pmremTarget = pmremGenerator.fromEquirectangular(texture)

		const { width, height } = texture.image
		renderTarget.setSize(width, height)
		copyQuad.material.envMap = pmremTarget.texture
		copyQuad.material.blur = blur

		const { blueNoiseRepeat, blueNoiseTexture, texSize } = copyQuad.material.uniforms

		blueNoiseRepeat.value.set(width / blueNoiseTexture.value.image.width, height / blueNoiseTexture.value.image.height)

		texSize.value.set(width, height)

		// render
		const prevRenderTarget = renderer.getRenderTarget()
		const prevClear = renderer.autoClear

		renderer.setRenderTarget(renderTarget)
		renderer.autoClear = true
		copyQuad.render(renderer)

		renderer.setRenderTarget(prevRenderTarget)
		renderer.autoClear = prevClear

		// read the data back
		const buffer = new Float32Array(width * height * 4)
		renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer)

		const result = new DataTexture(buffer, width, height, RGBAFormat, FloatType)
		result.minFilter = texture.minFilter
		result.magFilter = texture.magFilter
		result.wrapS = texture.wrapS
		result.wrapT = texture.wrapT
		result.mapping = EquirectangularReflectionMapping
		result.needsUpdate = true

		// dispose of the now unneeded target
		pmremTarget.dispose()

		console.timeEnd("blur")

		return result
	}
}
