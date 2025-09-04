# SQLite Offline Storage Setup

This document describes the SQLite offline storage implementation for the Wallex mobile application.

## Overview

The application uses SQLite for offline data storage with automatic fallback to localStorage for web platforms. This ensures data persistence across app sessions and enables offline functionality.

## Architecture

### Storage Service (`src/services/storage.ts`)
- **Platform Detection**: Automatically detects web vs native platforms
- **SQLite Integration**: Uses `@capacitor-community/sqlite` for native platforms
- **localStorage Fallback**: Falls back to localStorage for web platforms
- **Database Schema**: Creates `wallex_records` table with proper indexing

### Sync Service (`src/services/sync.ts`)
- **Online/Offline Detection**: Monitors network connectivity
- **Batch Synchronization**: Syncs unsynced records when online
- **Error Handling**: Comprehensive error handling and retry logic
- **Connection Testing**: Built-in API connection testing

### Data Types (`src/types/`)
- **WallexRecord**: Core data structure for financial records
- **Schemas**: Zod validation schemas for data integrity
- **Sync Types**: Types for synchronization operations

## Features

### Offline-First Design
- Records are saved locally first
- Automatic sync when connection is restored
- No data loss during network interruptions

### Cross-Platform Support
- **iOS/Android**: Native SQLite database
- **Web**: localStorage with same API
- **Seamless**: Same code works across all platforms

### Data Management
- Create, read, update, delete operations
- Category-based filtering
- Sync status tracking
- Bulk operations support

## Usage

### Basic Operations

```typescript
import { storageService } from '@/services/storage';

// Initialize storage
await storageService.initialize();

// Save a record
const record = await storageService.saveRecord({
  userId: 'user123',
  title: 'Coffee',
  description: 'Morning coffee',
  category: 'food',
  amount: 4.50,
  currency: 'USD'
});

// Get all records
const records = await storageService.getAllRecords();

// Get unsynced records
const unsynced = await storageService.getUnsyncedRecords();
```

### Synchronization

```typescript
import { syncService } from '@/services/sync';

// Check online status
const isOnline = syncService.isAppOnline();

// Sync all unsynced records
const result = await syncService.syncAllUnsyncedRecords(records);

// Test API connection
const connectionTest = await syncService.testConnection();
```

## Configuration

### Capacitor Configuration
The SQLite plugin is configured in `capacitor.config.ts`:

```typescript
plugins: {
  CapacitorSQLite: {
    iosDatabaseLocation: 'Library/CapacitorDatabase',
    iosIsEncryption: false,
    androidIsEncryption: false,
    // ... other platform-specific settings
  }
}
```

### Environment Variables
Set your API base URL in environment variables:

```bash
# Development
NODE_ENV=development
API_BASE_URL=http://localhost:3001

# Production
NODE_ENV=production
API_BASE_URL=https://your-api-domain.com
```

## Database Schema

```sql
CREATE TABLE wallex_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  synced INTEGER DEFAULT 0
);
```

## Dependencies

- `@capacitor-community/sqlite`: SQLite plugin for Capacitor
- `@capacitor-community/http`: HTTP client for API calls
- `zod`: Schema validation
- `@capacitor/core`: Core Capacitor functionality

## Demo Component

The `OfflineDemo` component demonstrates all functionality:
- Add sample records
- View all records with sync status
- Sync records when online
- Test API connection
- Clear all records

## Best Practices

1. **Always initialize storage** before using it
2. **Handle errors gracefully** - storage operations can fail
3. **Check online status** before attempting sync
4. **Use proper error boundaries** in React components
5. **Test on both platforms** - web and native behavior may differ

## Troubleshooting

### Common Issues

1. **Storage not initializing**: Check Capacitor plugin installation
2. **Sync failing**: Verify API endpoint and network connectivity
3. **Data not persisting**: Ensure proper database initialization
4. **Platform detection issues**: Check Capacitor platform detection

### Debug Mode

Enable debug logging by setting:
```typescript
console.log('Debug mode enabled');
```

## Future Enhancements

- [ ] Data encryption for sensitive information
- [ ] Conflict resolution for concurrent edits
- [ ] Background sync with push notifications
- [ ] Data compression for large datasets
- [ ] Backup and restore functionality
