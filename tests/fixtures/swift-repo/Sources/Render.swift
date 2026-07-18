import Foundation

protocol Drawable {
    func draw()
}

class Renderer {
    var origin: Point
    init(origin: Point) { self.origin = origin }
    func render(d: Drawable) -> Point { origin }
    private func reset() {}
}

extension Renderer: Drawable {
    func draw() {}
}

struct Ambig {}

enum Mode {
    case fast, slow
    func flip() -> Mode { self }
}
