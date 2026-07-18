import Foundation

struct App {
    let renderer = Renderer(origin: Point(x: 0, y: 0))
    var mode: Mode = .fast
    var url: URL? = nil

    // Ambig is declared in two files -> no edge; App is same-file -> no edge
    func confusing(a: Ambig) -> App { self }

    func top() -> Point { renderer.render(d: renderer) }
}

func launch(app: App) {}
