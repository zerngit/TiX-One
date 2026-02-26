import { concerts } from "../data/concerts";
import { ConcertCard } from "../components/ConcertCard";
import { Pagination } from "../components/Pagination";
import { AuthButtons } from "../components/AuthButtons";
import { PopBackground } from "../components/PopBackground";
import { Ticket, Filter } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { ADMIN_CAP_ID } from "../onechain/config";

const CONCERTS_PER_PAGE = 6;

export default function Home() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const [isOrganizer, setIsOrganizer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkOrganizer = async () => {
      if (!currentAccount?.address) { setIsOrganizer(false); return; }
      try {
        const adminCapObj = await suiClient.getObject({ id: ADMIN_CAP_ID, options: { showOwner: true } });
        const owner = (adminCapObj as any)?.data?.owner?.AddressOwner;
        if (!cancelled) setIsOrganizer(owner === currentAccount.address);
      } catch {
        if (!cancelled) setIsOrganizer(false);
      }
    };
    checkOrganizer();
    return () => { cancelled = true; };
  }, [currentAccount?.address, suiClient]);

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [selectedArtistOrigin, setSelectedArtistOrigin] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Extract unique values for filters
  const months = useMemo(() => {
    const uniqueMonths = new Set(
      concerts.map((concert) => {
        const date = new Date(concert.date);
        return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      })
    );
    return Array.from(uniqueMonths).sort();
  }, []);

  const regions = useMemo(() => {
    const uniqueRegions = new Set(concerts.map((concert) => concert.region));
    return Array.from(uniqueRegions).sort();
  }, []);

  const artistOrigins = useMemo(() => {
    const uniqueOrigins = new Set(concerts.map((concert) => concert.artistOrigin));
    return Array.from(uniqueOrigins).sort();
  }, []);

  // Filter concerts
  const filteredConcerts = useMemo(() => {
    return concerts.filter((concert) => {
      const concertMonth = new Date(concert.date).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

      const monthMatch = selectedMonth === "all" || concertMonth === selectedMonth;
      const regionMatch = selectedRegion === "all" || concert.region === selectedRegion;
      const originMatch =
        selectedArtistOrigin === "all" || concert.artistOrigin === selectedArtistOrigin;

      return monthMatch && regionMatch && originMatch;
    });
  }, [selectedMonth, selectedRegion, selectedArtistOrigin]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredConcerts.length / CONCERTS_PER_PAGE);
  const startIndex = (currentPage - 1) * CONCERTS_PER_PAGE;
  const endIndex = startIndex + CONCERTS_PER_PAGE;
  const currentConcerts = filteredConcerts.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const handleFilterChange = (filterType: string, value: string) => {
    setCurrentPage(1);
    if (filterType === "month") setSelectedMonth(value);
    if (filterType === "region") setSelectedRegion(value);
    if (filterType === "origin") setSelectedArtistOrigin(value);
  };

  const activeFiltersCount = [selectedMonth, selectedRegion, selectedArtistOrigin].filter(
    (f) => f !== "all"
  ).length;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Pop Art Interactive Background */}
      <PopBackground />
      
      {/* Animated Concert Lights Background */}
      <div className="concert-lights" />
      
      {/* Dynamic gradient background with animation */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 animate-lights -z-10" />

      {/* Header */}
      <header className="bg-black/40 backdrop-blur-md shadow-lg border-b border-pink-500/50 neon-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-pink-600 to-purple-600 rounded-lg shadow-lg neon-border">
                <Ticket className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl text-white neon-text">Tix-One Ticketing</h1>
                <p className="text-xs sm:text-sm text-pink-300">Blockchain-Powered Ticketing</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Link
                to="/my-ticket"
                className="px-4 py-2 rounded-lg bg-purple-900/50 border-2 border-pink-500/40 text-white hover:bg-purple-800/60 hover:border-pink-400 transition-all text-sm neon-border"
              >
                My Tickets
              </Link>
              <Link
                to="/marketplace"
                className="px-4 py-2 rounded-lg bg-purple-900/50 border-2 border-pink-500/40 text-white hover:bg-purple-800/60 hover:border-pink-400 transition-all text-sm neon-border"
              >
                Marketplace
              </Link>
              {isOrganizer && (
                <Link
                  to="/scanner"
                  className="px-4 py-2 rounded-lg bg-purple-900/50 border-2 border-pink-500/40 text-white hover:bg-purple-800/60 hover:border-pink-400 transition-all text-sm neon-border"
                >
                  Scanner
                </Link>
              )}
              <AuthButtons />
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 relative z-10">
        <div className="text-center mb-8">
          <h2 className="text-3xl md:text-5xl text-white mb-4 neon-text">Upcoming Concerts</h2>
          <p className="text-base md:text-lg text-pink-200 max-w-2xl mx-auto">
            Secure your tickets on the blockchain. Each ticket is a unique NFT, ensuring
            authenticity and preventing fraud.
          </p>
        </div>

        {/* Filters */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-900/50 backdrop-blur-sm border-2 border-pink-500 text-white rounded-lg hover:bg-purple-800/60 hover:border-pink-400 transition-all shadow-lg neon-border"
            >
              <Filter className="w-5 h-5" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <span className="ml-1 px-2 py-0.5 bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs rounded-full neon-border">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button
                onClick={() => {
                  setSelectedMonth("all");
                  setSelectedRegion("all");
                  setSelectedArtistOrigin("all");
                  setCurrentPage(1);
                }}
                className="text-sm text-pink-300 hover:text-pink-100 underline"
              >
                Clear all filters
              </button>
            )}
          </div>

          {showFilters && (
            <div className="bg-purple-900/40 backdrop-blur-md rounded-xl p-6 shadow-2xl border-2 border-pink-500/50 neon-border">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Month Filter */}
                <div>
                  <label className="block text-sm text-pink-200 mb-2">Month</label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => handleFilterChange("month", e.target.value)}
                    className="w-full px-4 py-2 bg-purple-950/50 border-2 border-pink-500/50 text-white rounded-lg focus:border-pink-400 focus:outline-none backdrop-blur-sm"
                  >
                    <option value="all">All Months</option>
                    {months.map((month) => (
                      <option key={month} value={month} className="bg-purple-950">
                        {month}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Region Filter */}
                <div>
                  <label className="block text-sm text-pink-200 mb-2">Region</label>
                  <select
                    value={selectedRegion}
                    onChange={(e) => handleFilterChange("region", e.target.value)}
                    className="w-full px-4 py-2 bg-purple-950/50 border-2 border-pink-500/50 text-white rounded-lg focus:border-pink-400 focus:outline-none backdrop-blur-sm"
                  >
                    <option value="all">All Regions</option>
                    {regions.map((region) => (
                      <option key={region} value={region} className="bg-purple-950">
                        {region}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Artist Origin Filter */}
                <div>
                  <label className="block text-sm text-pink-200 mb-2">Artist Origin</label>
                  <select
                    value={selectedArtistOrigin}
                    onChange={(e) => handleFilterChange("origin", e.target.value)}
                    className="w-full px-4 py-2 bg-purple-950/50 border-2 border-pink-500/50 text-white rounded-lg focus:border-pink-400 focus:outline-none backdrop-blur-sm"
                  >
                    <option value="all">All Origins</option>
                    {artistOrigins.map((origin) => (
                      <option key={origin} value={origin} className="bg-purple-950">
                        {origin}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Results Count */}
        <div className="mb-6">
          <p className="text-sm text-pink-300">
            Showing {currentConcerts.length} of {filteredConcerts.length} concerts
          </p>
        </div>

        {/* Concert Grid */}
        {currentConcerts.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {currentConcerts.map((concert) => {
  return <ConcertCard key={concert.id} concert={concert} />;
})}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            )}
          </>
        ) : (
          <div className="text-center py-16 bg-purple-900/30 backdrop-blur-sm rounded-2xl border-2 border-pink-500/30 neon-border">
            <p className="text-lg text-pink-200 mb-4">No concerts found matching your filters.</p>
            <button
              onClick={() => {
                setSelectedMonth("all");
                setSelectedRegion("all");
                setSelectedArtistOrigin("all");
                setCurrentPage(1);
              }}
              className="text-pink-300 hover:text-pink-100 underline"
            >
              Clear all filters
            </button>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="bg-black/60 backdrop-blur-md text-white mt-16 border-t-2 border-pink-500/50 neon-border relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-sm text-pink-300">
              © 2026 ChainTickets. Powered by OneChain blockchain technology.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}