/* eslint-disable camelcase */
import { UniformsUtils } from "three"
import { Color, GLSL3, Matrix3, ShaderMaterial, TangentSpaceNormalMap, Uniform, Vector2 } from "three"
import {
	velocity_fragment_main,
	velocity_fragment_pars,
	velocity_uniforms,
	velocity_vertex_main,
	velocity_vertex_pars
} from "../temporal-resolve/material/VelocityMaterial"

// will render normals to RGB channel of "gNormal" buffer, roughness to A channel of "gNormal" buffer, depth to RGBA channel of "gDepth" buffer
// and velocity to "gVelocity" buffer

export class MRTMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "MRTMaterial",

			defines: {
				USE_UV: "",
				TEMPORAL_RESOLVE: ""
			},

			uniforms: {
				color: new Uniform(new Color()),
				emissive: new Uniform(new Color()),
				map: new Uniform(null),
				roughnessMap: new Uniform(null),
				metalnessMap: new Uniform(null),
				emissiveMap: new Uniform(null),
				normalMap: new Uniform(null),
				normalScale: new Uniform(new Vector2(1, 1)),
				roughness: new Uniform(0),
				metalness: new Uniform(0),
				emissiveIntensity: new Uniform(0),
				uvTransform: new Uniform(new Matrix3()),
				boneTexture: new Uniform(null),
				...UniformsUtils.clone(velocity_uniforms)
			},
			vertexShader: /* glsl */ `
                varying vec2 vHighPrecisionZW;

                #define NORMAL
                #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
                    varying vec3 vViewPosition;
                #endif
                #include <common>
                #include <uv_pars_vertex>
                #include <displacementmap_pars_vertex>
                #include <normal_pars_vertex>
                #include <morphtarget_pars_vertex>
                #include <logdepthbuf_pars_vertex>
                #include <clipping_planes_pars_vertex>

                ${velocity_vertex_pars}

                void main() {
                    #include <uv_vertex>

                    #include <skinbase_vertex>
                    #include <beginnormal_vertex>
                    #include <skinnormal_vertex>
                    #include <defaultnormal_vertex>

                    #include <morphnormal_vertex>
                    #include <normal_vertex>
                    #include <begin_vertex>
                    #include <morphtarget_vertex>
                    #include <displacementmap_vertex>
                    #include <project_vertex>
                    #include <logdepthbuf_vertex>
                    #include <clipping_planes_vertex>
                    #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
                        vViewPosition = - mvPosition.xyz;
                    #endif

                    vHighPrecisionZW = gl_Position.zw;

                    ${velocity_vertex_main}
                }
            `,

			fragmentShader: /* glsl */ `
                #define NORMAL
                #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
                    varying vec3 vViewPosition;
                #endif
                #include <packing>
                #include <uv_pars_fragment>
                #include <normal_pars_fragment>
                #include <bumpmap_pars_fragment>
                #include <normalmap_pars_fragment>
                #include <logdepthbuf_pars_fragment>
                #include <clipping_planes_pars_fragment>
                
                layout(location = 0) out vec4 gDepth;
                layout(location = 1) out vec4 gNormal;
                layout(location = 2) out vec4 gDiffuse;
                layout(location = 3) out vec4 gEmissive;
                layout(location = 4) out vec4 gVelocity;

                ${velocity_fragment_pars}

                #include <map_pars_fragment>
                uniform vec3 color;

                varying vec2 vHighPrecisionZW;

                #include <metalnessmap_pars_fragment>
                uniform float metalness;

                #include <roughnessmap_pars_fragment>
                uniform float roughness;

                #include <emissivemap_pars_fragment>
                uniform vec3 emissive;
                uniform float emissiveIntensity;

                void main() {
                    #include <clipping_planes_fragment>
                    #include <logdepthbuf_fragment>
                    #include <normal_fragment_begin>
                    #include <normal_fragment_maps>

                    float roughnessFactor = roughness;
                    bool isDeselected = roughness > 10.0e9;
                    
                    if(isDeselected){
                        roughnessFactor = 1.;
                        gNormal = vec4(0.);
                    }else{
                        #ifdef USE_ROUGHNESSMAP
                            vec4 texelRoughness = texture2D( roughnessMap, vUv );
                            // reads channel G, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
                            roughnessFactor *= texelRoughness.g;
                        #endif

                        // roughness of 1.0 is reserved for deselected meshes
                        roughnessFactor = min(0.99, roughnessFactor);

                        vec3 normalColor = packNormalToRGB( normal );
                        gNormal = vec4( normalColor, roughnessFactor );
                    }
                    

                    if(isDeselected){
                        gDepth = vec4(0.);
                        gDiffuse = vec4(0.);
                        gVelocity = vec4(0.);

                        return;
                    }

                    float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;

                    vec4 depthColor = packDepthToRGBA( fragCoordZ );
                    gDepth = depthColor;

                    #include <metalnessmap_fragment>

                    vec4 diffuseColor = vec4(color, metalnessFactor);

                    #include <map_fragment>

                    gDiffuse = diffuseColor;

                    vec3 totalEmissiveRadiance = emissive;
                    #include <emissivemap_fragment>
                    
                    gEmissive = vec4(totalEmissiveRadiance, emissiveIntensity * 10.0); // encode for 8-bit to support values >1

                    ${velocity_fragment_main.replaceAll("gl_FragColor", "gVelocity")}
                }
            `,
			glslVersion: GLSL3,
			toneMapped: false
		})

		this.normalMapType = TangentSpaceNormalMap
		this.normalScale = new Vector2(1, 1)
	}
}
