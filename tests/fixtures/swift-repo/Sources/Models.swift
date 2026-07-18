struct Point {
    var x: Double
    var y: Double
    func mirrored() -> Point { Point(x: y, y: x) }
}

struct Size {
    var w: Double
    var h: Double
}

// declared here AND in Render.swift -> ambiguous, never a reference target
struct Ambig {}
