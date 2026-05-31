import mongoose from 'mongoose';

const { Schema } = mongoose;

const carSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true, index: true },
    make: { type: String, required: true },
    model: { type: String, required: true },
    variant: { type: String, default: '' },
    year: { type: Number, default: 2024 },
    bodyType: {
      type: String,
      enum: ['hatchback', 'sedan', 'suv', 'compact-suv', 'muv'],
      required: true,
    },
    fuelType: {
      type: String,
      enum: ['petrol', 'diesel', 'cng', 'hybrid', 'ev'],
      required: true,
    },
    transmission: { type: String, enum: ['manual', 'automatic'], default: 'manual' },
    seats: { type: Number, default: 5 },
    priceMinINR: { type: Number, required: true }, // ex-showroom (rupees)
    priceMaxINR: { type: Number, required: true }, // on-road / top variant (rupees)
    mileageKmpl: { type: Number, default: 0 }, // 0 for EV
    rangeKm: { type: Number, default: 0 }, // 0 for ICE
    safety: {
      ncapStars: { type: Number, default: 0 }, // 0-5
      airbags: { type: Number, default: 2 },
      esc: { type: Boolean, default: false },
    },
    bootLitres: { type: Number, default: 0 },
    specs: {
      groundClearanceMm: { type: Number, default: 0 },
      lengthMm: { type: Number, default: 0 },
      fuelTankL: { type: Number, default: 0 },
      sunroof: { type: Boolean, default: false },
    },
    features: { type: [String], default: [] },
    tags: { type: [String], default: [] }, // family, value, highway, first-car, city
    reviewSummary: { type: String, default: '' }, // pre-written, keeps us to 2 LLM calls
    reviewSentiment: { type: String, enum: ['positive', 'mixed', 'negative'], default: 'positive' },
    brochureUrl: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

carSchema.index({ priceMaxINR: 1 });
carSchema.index({ bodyType: 1, fuelType: 1 });

export const Car = mongoose.model('Car', carSchema);
