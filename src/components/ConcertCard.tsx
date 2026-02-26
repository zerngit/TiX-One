import { Link } from "react-router-dom";
import { Concert } from "../data/concerts";
import { Calendar, MapPin, Ticket } from "lucide-react";

interface ConcertCardProps {
  concert: Concert;
}

export function ConcertCard({ concert }: ConcertCardProps) {


  return (
    <Link
      to={`/concert/${concert.id}`}
      className="group block bg-gradient-to-br from-purple-950/80 to-indigo-950/80 backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl hover:shadow-pink-500/50 transition-all duration-300 hover:-translate-y-2 border-2 border-pink-500/50 neon-border hover:border-pink-400"
    >
      <div className="relative h-64 md:h-72 overflow-hidden">
        <img
          src={concert.posterUrl}
          alt={`${concert.artist} - ${concert.title}`}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-purple-950 via-transparent to-transparent opacity-60" />

        <div className="absolute top-4 right-4 bg-gradient-to-r from-pink-600 to-purple-600 text-white px-4 py-2 rounded-full text-sm backdrop-blur-sm shadow-lg neon-border">
          {concert.price}
        </div>

        <div className="absolute inset-0 bg-pink-600/0 group-hover:bg-pink-600/10 transition-all duration-300" />
      </div>

      <div className="p-5 bg-gradient-to-br from-purple-900/60 to-indigo-900/60 border-t-2 border-pink-500/30">
        <div className="mb-2">
          <span className="inline-block text-xs px-3 py-1 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-md neon-border">
            {concert.genre}
          </span>
        </div>

        <h3 className="text-xl mb-1 text-white group-hover:text-pink-300 transition-colors">
          {concert.artist}
        </h3>

        <p className="text-base text-pink-200 mb-3">
          {concert.title}
        </p>

        <div className="space-y-2 text-sm text-purple-300">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-pink-400" />
            <span>
              {concert.date} • {concert.time}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-pink-400" />
            <span>
              {concert.venue}, {concert.location}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-pink-400" />
            <span>
              {concert.availableTickets.toLocaleString()} tickets available
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}