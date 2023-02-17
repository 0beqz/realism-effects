import { ReprojectPass } from "./ReprojectPass"

export class VelocityPass extends ReprojectPass {
	constructor(scene, camera) {
		super(scene, camera, false)
	}
}
