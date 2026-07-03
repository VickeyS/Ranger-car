import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import Experience from '../Experience.js'
import SimpleCarModel from './SimpleCarModel.js'
import SimpleCarPhysics from './SimpleCarPhysics.js'

let instance = null

export default class SimpleCar {
    constructor() {
        // Singleton
        if (instance) {
            return instance
        }

        instance = this

        this.experience = new Experience()
        this.scene = this.experience.scene

        this.simpleCarModel = new SimpleCarModel()
        this.simpleCarPhysics = new SimpleCarPhysics()

        this.vehicle = this.simpleCarPhysics.vehicle

        this.time = this.experience.time

        // Keep reference to model (meshes accessed dynamically)
        this.chassisMesh = this.simpleCarModel.chassisMesh

        // For camera tracking
        this.forwardDirection = new THREE.Vector3(0, 0, 1)
        this.tempQuat = new THREE.Quaternion()

        // Audio (engine) state
        this.audioCtx = null
        this.engineOsc = null
        this.engineGain = null
        this.engineStarted = false
    }

    // Get the car's forward direction for camera
    getForwardDirection() {
        if (!this.chassisMesh) return this.forwardDirection

        // Get forward direction from chassis rotation
        this.tempQuat.copy(this.chassisMesh.quaternion)
        this.forwardDirection.set(0, 0, 1)
        this.forwardDirection.applyQuaternion(this.tempQuat)
        this.forwardDirection.y = 0
        this.forwardDirection.normalize()

        return this.forwardDirection
    }

    // Get car position
    getPosition() {
        if (!this.chassisMesh) return new THREE.Vector3(5, 0, 0)
        return this.chassisMesh.position.clone()
    }

    // Update car color from settings
    updateColor(colorHex) {
        if (this.chassisMesh && this.chassisMesh.children) {
            this.chassisMesh.children.forEach(child => {
                if (child.material && child.material.color) {
                    // Only update the main body, not windows or other parts
                    const currentHex = child.material.color.getHex()
                    // Check if it's a bright color (not black/gray for windows)
                    if (currentHex > 0x333333) {
                        child.material.color.set(colorHex)
                        if (child.material.emissive) {
                            child.material.emissive.set(colorHex)
                            child.material.emissiveIntensity = 0.1
                        }
                    }
                }
            })
        }
    }

    // Reset car position
    resetPosition() {
        const chassis = this.vehicle.chassisBody
        if (chassis) {
            // Stop all motion first
            chassis.velocity.setZero()
            chassis.angularVelocity.setZero()

            // Reset position - on the starting line
            chassis.position.set(55, 2, 5)

            // Reset rotation to face forward (along the track)
            chassis.quaternion.setFromAxisAngle(
                new CANNON.Vec3(0, 1, 0),
                -Math.PI / 2
            )

            // Wake up the body
            chassis.wakeUp()
        }

        // Reset wheels
        if (this.vehicle.wheelBodies) {
            this.vehicle.wheelBodies.forEach(wheel => {
                wheel.velocity.setZero()
                wheel.angularVelocity.setZero()
                wheel.wakeUp()
            })
        }
    }

    update() {
        if (this.chassisMesh) {
            this.simpleCarModel.updateMeshPosition(this.chassisMesh, this.vehicle.chassisBody)
        }

        // Wheels are stored on the model; reference them each tick so design swaps work
        const f1 = this.simpleCarModel.frontWheelMesh1
        const f2 = this.simpleCarModel.frontWheelMesh2
        const r1 = this.simpleCarModel.rearWheelMesh1
        const r2 = this.simpleCarModel.rearWheelMesh2

        if (f1) this.simpleCarModel.updateMeshPosition(f1, this.vehicle.wheelBodies[2])
        if (f2) this.simpleCarModel.updateMeshPosition(f2, this.vehicle.wheelBodies[3])
        if (r1) this.simpleCarModel.updateMeshPosition(r1, this.vehicle.wheelBodies[0])
        if (r2) this.simpleCarModel.updateMeshPosition(r2, this.vehicle.wheelBodies[1])

        // Update camera to follow car
        if (!this.experience.camera.testingMode && this.chassisMesh) {
            this.experience.camera.followTarget(
                this.chassisMesh.position,
                this.getForwardDirection()
            )
        }

        // Update engine sound if started
        if (this.engineStarted && this.vehicle && this.vehicle.chassisBody) {
            const vel = this.vehicle.chassisBody.velocity
            const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

            // Map speed to frequency and volume
            const baseFreq = 120
            const freq = baseFreq + Math.min(1400, speed * 60)
            const minGain = 0.02
            const maxGain = 0.45
            const gain = Math.min(maxGain, minGain + (speed / 20) * 0.12)

            if (this.engineOsc) this.engineOsc.frequency.setTargetAtTime(freq, this.audioCtx.currentTime, 0.05)
            if (this.engineGain) this.engineGain.gain.setTargetAtTime(gain, this.audioCtx.currentTime, 0.1)
        }
    }

    startEngine() {
        if (this.engineStarted) return

        const AudioContext = window.AudioContext || window.webkitAudioContext
        try {
            this.audioCtx = new AudioContext()
        } catch (e) {
            console.warn('WebAudio not supported', e)
            return
        }

        this.engineGain = this.audioCtx.createGain()
        this.engineGain.gain.value = 0.02

        this.engineOsc = this.audioCtx.createOscillator()
        this.engineOsc.type = 'sawtooth'
        this.engineOsc.frequency.value = 120

        this.engineOsc.connect(this.engineGain)
        this.engineGain.connect(this.audioCtx.destination)

        // Start oscillator after a user gesture (this method should be called from an input handler)
        try {
            // Some browsers require resume before starting
            if (this.audioCtx.state === 'suspended' && this.audioCtx.resume) {
                this.audioCtx.resume().then(() => {
                    this.engineOsc.start()
                    this.engineStarted = true
                })
            } else {
                this.engineOsc.start()
                this.engineStarted = true
            }
        } catch (err) {
            console.warn('Could not start engine audio', err)
        }
    }

    stopEngine() {
        if (!this.engineStarted) return
        try {
            if (this.engineOsc) this.engineOsc.stop()
            if (this.audioCtx && this.audioCtx.close) this.audioCtx.close()
        } catch (e) {
            // ignore
        }
        this.engineStarted = false
        this.audioCtx = null
        this.engineOsc = null
        this.engineGain = null
    }
}
