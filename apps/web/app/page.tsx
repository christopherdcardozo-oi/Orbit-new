import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col items-center justify-center bg-gray-950">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-900/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-900/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gray-900/50 via-gray-950 to-gray-950"></div>
      </div>

      <div className="relative z-10 container mx-auto px-6 py-24 text-center">
        {/* Hero */}
        <h1 className="text-6xl md:text-8xl font-black mb-6 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-cyan-400 drop-shadow-sm">
          Orbit
        </h1>
        <p className="text-xl md:text-2xl text-gray-300 mb-12 max-w-2xl mx-auto font-light tracking-wide">
          Anonymous connections. One campus. Reset at midnight.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-24">
          <Link href="/signup" className="px-8 py-4 bg-white text-gray-950 font-bold rounded-full hover:bg-gray-200 transition-colors transform hover:scale-105 active:scale-95 duration-200 shadow-[0_0_20px_rgba(255,255,255,0.3)]">
            Get Started
          </Link>
          <Link href="/login" className="px-8 py-4 bg-gray-800/50 text-white font-semibold rounded-full border border-gray-700 hover:bg-gray-800 hover:border-gray-600 transition-all transform hover:scale-105 active:scale-95 duration-200 backdrop-blur-sm">
            Sign In
          </Link>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto text-left">
          <div className="p-8 rounded-3xl bg-gray-900/50 border border-gray-800 backdrop-blur-md hover:border-purple-500/50 transition-colors group">
            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform origin-left">🎭</div>
            <h3 className="text-xl font-bold mb-3 text-white">Completely Anonymous</h3>
            <p className="text-gray-400 leading-relaxed">
              No names, no profiles visible. Just pure conversation without the weight of expectations.
            </p>
          </div>
          
          <div className="p-8 rounded-3xl bg-gray-900/50 border border-gray-800 backdrop-blur-md hover:border-pink-500/50 transition-colors group">
            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform origin-left">🌙</div>
            <h3 className="text-xl font-bold mb-3 text-white">The Midnight Reset</h3>
            <p className="text-gray-400 leading-relaxed">
              Every connection is fleeting. At midnight, the slate wipes clean and a new cycle begins.
            </p>
          </div>
          
          <div className="p-8 rounded-3xl bg-gray-900/50 border border-gray-800 backdrop-blur-md hover:border-cyan-500/50 transition-colors group">
            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform origin-left">🔒</div>
            <h3 className="text-xl font-bold mb-3 text-white">Campus Only</h3>
            <p className="text-gray-400 leading-relaxed">
              Verified .edu emails only. Connect securely within your campus community.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
