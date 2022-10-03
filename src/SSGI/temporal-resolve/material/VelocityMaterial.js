// this shader is from: https://github.com/gkjohnson/threejs-sandbox
/* eslint-disable camelcase */

import { GLSL3, UniformsUtils } from "three"
import { Matrix4, ShaderChunk, ShaderMaterial } from "three"

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
varying vec2 vHighPrecisionZW;
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

vHighPrecisionZW = gl_Position.zw;
`

export const velocity_fragment_pars = /* glsl */ `
varying vec4 prevPosition;
varying vec4 newPosition;
varying vec2 vHighPrecisionZW;
`

export const velocity_fragment_main = /* glsl */ `
#ifdef FULL_MOVEMENT
gl_FragColor = vec4( 1.);
return;
#else

vec2 pos0 = (prevPosition.xy / prevPosition.w) * 0.5 + 0.5;
vec2 pos1 = (newPosition.xy / newPosition.w) * 0.5 + 0.5;

vec2 vel = pos1 - pos0;
vel = 0.5 * vel + 0.5; // as pack2HalfToRGBA doesn't support negative numbers

float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;

gl_FragColor = pack2HalfToRGBA(vel);
#endif
`

export const velocity_uniforms = {
	prevVelocityMatrix: { value: new Matrix4() },
	velocityMatrix: { value: new Matrix4() },
	prevBoneTexture: { value: null },
	boneTexture: { value: null }
}

export class VelocityMaterial extends ShaderMaterial {
	constructor() {
		super({
			uniforms: UniformsUtils.clone(velocity_uniforms),

			vertexShader: /* glsl */ `
                    ${velocity_vertex_pars}
        
                    void main() {
						vec3 transformed;

						#include <skinbase_vertex>
						#include <beginnormal_vertex>
						#include <skinnormal_vertex>
						#include <defaultnormal_vertex>

						${velocity_vertex_main}
                    }`,
			fragmentShader: /* glsl */ `
					layout(location = 0) out vec4 gVelocity;
					layout(location = 1) out vec4 gDepth;

					${velocity_fragment_pars}
					#include <packing>
        
                    void main() {
						${velocity_fragment_main.replaceAll("gl_FragColor", "gVelocity")}

						gDepth = packDepthToRGBA(fragCoordZ);
                    }`
		})

		this.glslVersion = GLSL3

		this.isVelocityMaterial = true
	}
}
