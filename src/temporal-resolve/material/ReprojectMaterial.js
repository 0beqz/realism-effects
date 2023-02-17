// this shader is from: https://github.com/gkjohnson/threejs-sandbox
/* eslint-disable camelcase */

import { GLSL3, Matrix3, Matrix4, ShaderChunk, ShaderMaterial, UniformsUtils, Vector2 } from "three"

// Modified ShaderChunk.skinning_pars_vertex to handle
// a second set of bone information from the previous frame
const prev_skinning_pars_vertex = /* glsl */ `
		#ifdef USE_SKINNING
		#ifdef BONE_TEXTURE
			uniform sampler2D prevBoneTexture;
			mat4 getPrevBoneMatrix( const in float i ) {
				float j = i * 4.0;
				float x = mod( j, float( boneTextureSize ) );
				float y = floor( j / float( boneTextureSize ) );
				float dx = 1.0 / float( boneTextureSize );
				float dy = 1.0 / float( boneTextureSize );
				y = dy * ( y + 0.5 );
				vec4 v1 = texture2D( prevBoneTexture, vec2( dx * ( x + 0.5 ), y ) );
				vec4 v2 = texture2D( prevBoneTexture, vec2( dx * ( x + 1.5 ), y ) );
				vec4 v3 = texture2D( prevBoneTexture, vec2( dx * ( x + 2.5 ), y ) );
				vec4 v4 = texture2D( prevBoneTexture, vec2( dx * ( x + 3.5 ), y ) );
				mat4 bone = mat4( v1, v2, v3, v4 );
				return bone;
			}
		#else
			uniform mat4 prevBoneMatrices[ MAX_BONES ];
			mat4 getPrevBoneMatrix( const in float i ) {
				mat4 bone = prevBoneMatrices[ int(i) ];
				return bone;
			}
		#endif
		#endif
`

export const velocity_vertex_pars = /* glsl */ `
#define MAX_BONES 64
                    
${ShaderChunk.skinning_pars_vertex}
${prev_skinning_pars_vertex}

uniform mat4 velocityMatrix;
uniform mat4 prevVelocityMatrix;
varying vec4 prevPosition;
varying vec4 newPosition;

#ifdef renderDepthNormal
varying vec2 vHighPrecisionZW;
#endif
`

// Returns the body of the vertex shader for the velocity buffer
export const velocity_vertex_main = /* glsl */ `
// Get the current vertex position
transformed = vec3( position );
${ShaderChunk.skinning_vertex}
newPosition = velocityMatrix * vec4( transformed, 1.0 );

// Get the previous vertex position
transformed = vec3( position );
${ShaderChunk.skinbase_vertex.replace(/mat4 /g, "").replace(/getBoneMatrix/g, "getPrevBoneMatrix")}
${ShaderChunk.skinning_vertex.replace(/vec4 /g, "")}
prevPosition = prevVelocityMatrix * vec4( transformed, 1.0 );

gl_Position = newPosition;

#ifdef renderDepthNormal
vHighPrecisionZW = gl_Position.zw;
#endif
`

export const velocity_fragment_pars = /* glsl */ `
varying vec4 prevPosition;
varying vec4 newPosition;

#ifdef renderDepthNormal
varying vec2 vHighPrecisionZW;
#endif
`

export const velocity_fragment_main = /* glsl */ `
vec2 pos0 = (prevPosition.xy / prevPosition.w) * 0.5 + 0.5;
vec2 pos1 = (newPosition.xy / newPosition.w) * 0.5 + 0.5;

vec2 vel = pos1 - pos0;

#ifdef renderDepthNormal
float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
#endif

gl_FragColor = vec4(vel.x, vel.y, 0., 0.);
`

export const velocity_uniforms = {
	prevVelocityMatrix: { value: new Matrix4() },
	velocityMatrix: { value: new Matrix4() },
	prevBoneTexture: { value: null },
	boneTexture: { value: null },
	normalMap: { value: null },
	normalScale: { value: new Vector2() },
	uvTransform: { value: new Matrix3() }
}

export class ReprojectMaterial extends ShaderMaterial {
	constructor() {
		super({
			uniforms: UniformsUtils.clone(velocity_uniforms),
			glslVersion: GLSL3,
			vertexShader: /* glsl */ `
					#include <common>
					#include <uv_pars_vertex>
					#include <displacementmap_pars_vertex>
					#include <normal_pars_vertex>
					#include <morphtarget_pars_vertex>
					#include <logdepthbuf_pars_vertex>
					#include <clipping_planes_pars_vertex>

					#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
						varying vec3 vViewPosition;
					#endif
					
                    ${velocity_vertex_pars}
        
                    void main() {
						vec3 transformed;

						#include <uv_vertex>

						#include <skinbase_vertex>
						#include <beginnormal_vertex>
						#include <skinnormal_vertex>
						#include <defaultnormal_vertex>

						#include <morphnormal_vertex>
						#include <normal_vertex>
						#include <morphtarget_vertex>
						#include <displacementmap_vertex>
						#include <project_vertex>
						#include <logdepthbuf_vertex>
						#include <clipping_planes_vertex>

						${velocity_vertex_main}

						#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
							vViewPosition = - mvPosition.xyz;
						#endif

                    }`,
			fragmentShader: /* glsl */ `
					#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
						varying vec3 vViewPosition;
					#endif

					#ifdef renderDepthNormal
					layout(location = 0) out vec4 gVelocity;
					layout(location = 1) out vec4 gDepth;
					layout(location = 2) out vec4 gNormal;
					#else
					#define gVelocity gl_FragColor
					#endif

					${velocity_fragment_pars}
					#include <packing>

					#include <uv_pars_fragment>
					#include <normal_pars_fragment>
					#include <bumpmap_pars_fragment>
					#include <normalmap_pars_fragment>
        
                    void main() {
						#include <normal_fragment_begin>
                    	#include <normal_fragment_maps>

						${velocity_fragment_main.replaceAll("gl_FragColor", "gVelocity")}

						#ifdef renderDepthNormal
						gDepth = packDepthToRGBA(fragCoordZ);

						gNormal = vec4(packNormalToRGB( normal ), 0.);
						#endif
                    }`
		})

		this.isVelocityMaterial = true
	}
}
