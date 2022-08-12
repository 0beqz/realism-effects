﻿import { Pass } from "postprocessing"
import {
	Color,
	DataTexture,
	FloatType,
	HalfFloatType,
	Matrix4,
	Quaternion,
	RGBAFormat,
	Vector3,
	VideoTexture,
	WebGLRenderTarget
} from "three"
import { getVisibleChildren } from "../../utils/Utils.js"
import { VelocityMaterial } from "../material/VelocityMaterial.js"

const backgroundColor = new Color(0)
const updateProperties = ["visible", "wireframe", "side"]

export class VelocityPass extends Pass {
	cachedMaterials = new WeakMap()
	lastCameraTransform = {
		position: new Vector3(),
		quaternion: new Quaternion()
	}
	visibleMeshes = []
	renderedMeshesThisFrame = 0
	renderedMeshesLastFrame = 0

	constructor(scene, camera) {
		super("VelocityPass")

		this._scene = scene
		this._camera = camera

		this.renderTarget = new WebGLRenderTarget(window?.innerWidth || 1000, window?.innerHeight || 1000, {
			type: HalfFloatType
		})
	}

	setVelocityMaterialInScene() {
		this.renderedMeshesThisFrame = 0

		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, velocityMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				velocityMaterial = new VelocityMaterial()
				velocityMaterial.lastMatrixWorld = new Matrix4()

				c.material = velocityMaterial

				if (c.skeleton?.boneTexture) this.saveBoneTexture(c)

				this.cachedMaterials.set(c, [originalMaterial, velocityMaterial])
			}

			velocityMaterial.uniforms.velocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)

			if (c.userData.needsUpdatedReflections || originalMaterial.map instanceof VideoTexture) {
				if (!("FULL_MOVEMENT" in velocityMaterial.defines)) velocityMaterial.needsUpdate = true
				velocityMaterial.defines.FULL_MOVEMENT = ""
			} else {
				if ("FULL_MOVEMENT" in velocityMaterial.defines) {
					delete velocityMaterial.defines.FULL_MOVEMENT
					velocityMaterial.needsUpdate = true
				}
			}

			c.visible =
				this.cameraMovedThisFrame ||
				!c.matrixWorld.equals(velocityMaterial.lastMatrixWorld) ||
				c.skeleton ||
				"FULL_MOVEMENT" in velocityMaterial.defines

			c.material = velocityMaterial

			if (!c.visible) continue

			this.renderedMeshesThisFrame++

			for (const prop of updateProperties) velocityMaterial[prop] = originalMaterial[prop]

			if (c.skeleton?.boneTexture) {
				velocityMaterial.defines.USE_SKINNING = ""
				velocityMaterial.defines.BONE_TEXTURE = ""

				velocityMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture
			}
		}
	}

	saveBoneTexture(object) {
		let boneTexture = object.material.uniforms.prevBoneTexture.value

		if (boneTexture && boneTexture.image.width === object.skeleton.boneTexture.width) {
			boneTexture = object.material.uniforms.prevBoneTexture.value
			boneTexture.image.data.set(object.skeleton.boneTexture.image.data)
		} else {
			boneTexture?.dispose()

			const boneMatrices = object.skeleton.boneTexture.image.data.slice()
			const size = object.skeleton.boneTexture.image.width

			boneTexture = new DataTexture(boneMatrices, size, size, RGBAFormat, FloatType)
			object.material.uniforms.prevBoneTexture.value = boneTexture

			boneTexture.needsUpdate = true
		}
	}

	unsetVelocityMaterialInScene() {
		for (const c of this.visibleMeshes) {
			if (c.material.isVelocityMaterial) {
				c.visible = true

				c.material.lastMatrixWorld.copy(c.matrixWorld)
				c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)

				if (c.skeleton?.boneTexture) this.saveBoneTexture(c)

				c.material = this.cachedMaterials.get(c)[0]
			}
		}
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	renderVelocity(renderer) {
		renderer.setRenderTarget(this.renderTarget)

		if (this.renderedMeshesThisFrame > 0) {
			const { background } = this._scene

			this._scene.background = backgroundColor

			renderer.render(this._scene, this._camera)

			this._scene.background = background
		} else {
			renderer.clearColor()
		}
	}

	checkCameraMoved() {
		const moveDist = this.lastCameraTransform.position.distanceToSquared(this._camera.position)
		const rotateDist = 8 * (1 - this.lastCameraTransform.quaternion.dot(this._camera.quaternion))

		if (moveDist > 0.000001 || rotateDist > 0.000001) {
			this.lastCameraTransform.position.copy(this._camera.position)
			this.lastCameraTransform.quaternion.copy(this._camera.quaternion)

			return true
		}

		return false
	}

	render(renderer) {
		this.cameraMovedThisFrame = this.checkCameraMoved()

		this.setVelocityMaterialInScene()

		if (this.renderedMeshesThisFrame > 0 || this.renderedMeshesLastFrame > 0) this.renderVelocity(renderer)

		this.unsetVelocityMaterialInScene()

		this.renderedMeshesLastFrame = this.renderedMeshesThisFrame
	}
}
